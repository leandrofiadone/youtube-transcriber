import express, { Request, Response } from 'express';
import cors from 'cors';
import youtubedl from 'youtube-dl-exec';
import { unlinkSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { pipeline } from '@xenova/transformers';
import { execSync } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3001;
const TRANSCRIPTIONS_DIR = join(process.cwd(), 'transcriptions');

// Crear carpeta de transcripciones si no existe
if (!existsSync(TRANSCRIPTIONS_DIR)) {
  mkdirSync(TRANSCRIPTIONS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());

// Health check endpoint para UptimeRobot
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    model: transcriber ? 'loaded' : 'not loaded'
  });
});

// Inicializar el modelo Whisper (se carga una sola vez)
let transcriber: any = null;

async function getTranscriber(onProgress?: (msg: string) => void) {
  if (!transcriber) {
    onProgress?.('Cargando modelo Whisper (~500MB, solo la primera vez)...');
    console.log('🔵 Cargando modelo Whisper...');
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small');
    console.log('✅ Modelo Whisper cargado');
  }
  return transcriber;
}

// Endpoint con streaming de progreso (SSE)
app.get('/api/transcribe-stream', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  let outputPath: string | null = null;

  // Configurar SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no'); // Deshabilitar buffering en nginx
  res.flushHeaders(); // Enviar headers inmediatamente

  const sendProgress = (step: string, progress: number, message: string) => {
    res.write(`data: ${JSON.stringify({ step, progress, message })}\n\n`);
  };

  const sendComplete = (data: any) => {
    res.write(`data: ${JSON.stringify({ step: 'complete', progress: 100, ...data })}\n\n`);
    res.end();
  };

  const sendError = (error: string) => {
    res.write(`data: ${JSON.stringify({ step: 'error', progress: 0, error })}\n\n`);
    res.end();
  };

  try {
    if (!url) {
      return sendError('URL es requerida');
    }

    // Paso 1: Descargando audio (0-30%)
    sendProgress('download', 5, 'Conectando con YouTube...');
    console.log(`🔵 Descargando audio de: ${url}`);

    const timestamp = Date.now();
    outputPath = join(process.cwd(), `audio-${timestamp}.wav`);

    sendProgress('download', 15, 'Descargando audio del video...');

    await youtubedl(url, {
      extractAudio: true,
      audioFormat: 'wav',
      output: outputPath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      postprocessorArgs: 'ffmpeg:-ar 16000 -ac 1',
      // Opciones para evitar detección de bot
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      format: 'bestaudio/best',
      addHeader: [
        'referer:youtube.com',
        'accept-language:en-US,en;q=0.9'
      ]
    });

    sendProgress('download', 30, 'Audio descargado correctamente');
    console.log(`✅ Audio descargado: ${outputPath}`);

    // Paso 2: Procesando audio (30-40%)
    sendProgress('process', 35, 'Convirtiendo audio a formato PCM...');
    console.log(`🔵 Convirtiendo audio a PCM...`);

    // Convertir WAV a raw PCM float32 usando ffmpeg
    const pcmPath = join(process.cwd(), `audio-${timestamp}.pcm`);
    try {
      execSync(`ffmpeg -i "${outputPath}" -f f32le -acodec pcm_f32le -ar 16000 -ac 1 "${pcmPath}" -y`, {
        stdio: 'pipe'
      });
    } catch (error: any) {
      sendError('Error al procesar el audio con ffmpeg');
      try {
        unlinkSync(outputPath);
      } catch (err) {
        // Ignorar
      }
      return;
    }

    sendProgress('process', 37, 'Analizando duracion del audio...');
    console.log(`🔵 Analizando audio...`);

    // Obtener duración del audio sin cargarlo todo en memoria
    const statsPcm = statSync(pcmPath);
    const audioDuration = (statsPcm.size / 4) / 16000; // 4 bytes por float, 16000 Hz
    console.log(`📊 Audio: ${Math.round(audioDuration)}s (${(audioDuration / 60).toFixed(1)} minutos)`);

    const MAX_DURATION_SECONDS = 3600; // 1 hora
    let fullTranscription = '';

    if (audioDuration > MAX_DURATION_SECONDS) {
      // Audio largo - dividir y procesar por segmentos
      const SEGMENT_DURATION = 1800; // 30 minutos por segmento
      const totalSegments = Math.ceil(audioDuration / SEGMENT_DURATION);

      sendProgress('process', 40, `Audio largo detectado (${Math.round(audioDuration / 60)}min). Dividiendo en ${totalSegments} segmentos...`);
      console.log(`⚠️ Audio largo: ${Math.round(audioDuration)}s. Procesando en ${totalSegments} segmentos de ${SEGMENT_DURATION}s`);

      // Paso 3: Cargando modelo (40-50%)
      sendProgress('model', 45, 'Preparando modelo de transcripcion...');
      const model = await getTranscriber((msg) => sendProgress('model', 47, msg));
      sendProgress('model', 50, 'Modelo listo');

      // Procesar cada segmento
      for (let i = 0; i < totalSegments; i++) {
        const startSample = i * SEGMENT_DURATION * 16000;
        const endSample = Math.min((i + 1) * SEGMENT_DURATION * 16000, audioDuration * 16000);
        const segmentDuration = (endSample - startSample) / 16000;

        sendProgress('transcribe', 50 + Math.round((i / totalSegments) * 40), `Procesando segmento ${i + 1}/${totalSegments}...`);
        console.log(`🔵 Segmento ${i + 1}/${totalSegments}: ${Math.round(segmentDuration)}s`);

        // Extraer segmento del PCM
        const segmentPcmPath = join(process.cwd(), `segment-${timestamp}-${i}.pcm`);
        execSync(`ffmpeg -f f32le -ar 16000 -ac 1 -i "${pcmPath}" -ss ${i * SEGMENT_DURATION} -t ${SEGMENT_DURATION} -f f32le "${segmentPcmPath}" -y`, {
          stdio: 'pipe'
        });

        // Cargar y transcribir segmento
        const segmentBuffer = readFileSync(segmentPcmPath);
        const segmentAudio = new Float32Array(segmentBuffer.buffer, segmentBuffer.byteOffset, segmentBuffer.length / 4);

        const segmentResult = await model(segmentAudio, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: false,
          task: 'transcribe',
          sampling_rate: 16000
        });

        fullTranscription += segmentResult.text + ' ';

        // Limpiar segmento temporal
        try {
          unlinkSync(segmentPcmPath);
        } catch (err) {
          console.error('Error al eliminar segmento:', err);
        }

        console.log(`✅ Segmento ${i + 1}/${totalSegments} completado`);
      }

      // Limpiar archivo PCM temporal
      try {
        unlinkSync(pcmPath);
      } catch (err) {
        console.error('Error al eliminar PCM temporal:', err);
      }

      sendProgress('transcribe', 90, 'Transcripcion completa');

    } else {
      // Audio normal - procesar de una vez
      sendProgress('process', 37, 'Cargando audio procesado...');
      console.log(`🔵 Cargando audio procesado...`);

      const pcmBuffer = readFileSync(pcmPath);
      const float32Audio = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 4);

      // Limpiar archivo PCM temporal
      try {
        unlinkSync(pcmPath);
      } catch (err) {
        console.error('Error al eliminar PCM temporal:', err);
      }

      sendProgress('process', 40, `Audio listo (${Math.round(audioDuration)}s de duracion)`);

      // Paso 3: Cargando modelo (40-50%)
      sendProgress('model', 45, 'Preparando modelo de transcripcion...');
      const model = await getTranscriber((msg) => sendProgress('model', 47, msg));
      sendProgress('model', 50, 'Modelo listo');

      // Paso 4: Transcribiendo (50-90%)
      const totalChunks = Math.ceil(audioDuration / 20);
      sendProgress('transcribe', 55, 'Iniciando transcripcion...');
      console.log(`🔵 Transcribiendo audio...`);
      console.log(`📊 Audio: ${Math.round(audioDuration)}s (${totalChunks} chunks)`);

      let chunksProcessed = 0;
      const result = await model(float32Audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
        task: 'transcribe',
        sampling_rate: 16000,
        chunk_callback: (_chunk: any) => {
          chunksProcessed++;
          const chunkPercent = Math.round((chunksProcessed / totalChunks) * 100);
          const overallProgress = 55 + Math.round((chunkPercent / 100) * 35); // 55% a 90%
          console.log(`⏳ Transcribiendo: ${chunkPercent}% (chunk ${chunksProcessed}/${totalChunks})`);
          sendProgress('transcribe', overallProgress, `Transcribiendo: chunk ${chunksProcessed}/${totalChunks}`);
        }
      });

      fullTranscription = result.text;
      sendProgress('transcribe', 90, 'Transcripcion completa');
    }
    console.log(`✅ Transcripción completa`);
    console.log(`📏 Longitud del texto: ${fullTranscription.length} caracteres`);

    // Paso 5: Guardando archivos (90-100%)
    sendProgress('save', 92, 'Guardando archivos...');

    try {
      unlinkSync(outputPath);
      console.log(`🗑️ Archivo temporal eliminado: ${outputPath}`);
    } catch (err) {
      console.error('Error al eliminar archivo temporal:', err);
    }

    const filename = `transcription-${timestamp}`;
    const txtPath = join(TRANSCRIPTIONS_DIR, `${filename}.txt`);
    const jsonPath = join(TRANSCRIPTIONS_DIR, `${filename}.json`);

    writeFileSync(txtPath, fullTranscription, 'utf-8');
    console.log(`💾 Guardado: ${txtPath}`);

    const jsonData = {
      url,
      timestamp: new Date().toISOString(),
      text: fullTranscription,
      length: fullTranscription.length
    };
    writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    console.log(`💾 Guardado: ${jsonPath}`);

    sendProgress('save', 98, 'Archivos guardados');

    sendComplete({
      message: 'Transcripcion completada',
      text: fullTranscription,
      files: { txt: txtPath, json: jsonPath }
    });

  } catch (error) {
    console.error('❌ Error:', error);

    if (outputPath) {
      try {
        unlinkSync(outputPath);
      } catch (err) {
        // Ignorar
      }
    }

    sendError('Error al procesar la solicitud');
  }
});

// Endpoint original sin streaming
app.post('/api/transcribe', async (req: Request, res: Response) => {
  let outputPath: string | null = null;

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL es requerida' });
    }

    console.log(`🔵 Descargando audio de: ${url}`);

    const timestamp = Date.now();
    outputPath = join(process.cwd(), `audio-${timestamp}.wav`);

    await youtubedl(url, {
      extractAudio: true,
      audioFormat: 'wav',
      output: outputPath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      postprocessorArgs: 'ffmpeg:-ar 16000 -ac 1',
      // Opciones para evitar detección de bot
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      format: 'bestaudio/best',
      addHeader: [
        'referer:youtube.com',
        'accept-language:en-US,en;q=0.9'
      ]
    });

    console.log(`✅ Audio descargado: ${outputPath}`);

    console.log(`🔵 Convirtiendo audio a PCM...`);
    // Convertir WAV a raw PCM float32 usando ffmpeg
    const pcmPath = join(process.cwd(), `audio-${timestamp}.pcm`);
    try {
      execSync(`ffmpeg -i "${outputPath}" -f f32le -acodec pcm_f32le -ar 16000 -ac 1 "${pcmPath}" -y`, {
        stdio: 'pipe'
      });
    } catch (error: any) {
      try {
        unlinkSync(outputPath);
      } catch (err) {
        // Ignorar
      }
      return res.status(500).json({ error: 'Error al procesar el audio con ffmpeg' });
    }

    console.log(`🔵 Analizando audio...`);
    // Obtener duración sin cargar todo en memoria
    const statsPcm = statSync(pcmPath);
    const audioDuration = (statsPcm.size / 4) / 16000;
    console.log(`📊 Audio: ${Math.round(audioDuration)}s (${(audioDuration / 60).toFixed(1)} minutos)`);

    const MAX_DURATION_SECONDS = 3600; // 1 hora
    let fullTranscription = '';

    if (audioDuration > MAX_DURATION_SECONDS) {
      // Audio largo - dividir y procesar por segmentos
      const SEGMENT_DURATION = 1800; // 30 minutos
      const totalSegments = Math.ceil(audioDuration / SEGMENT_DURATION);
      console.log(`⚠️ Audio largo: ${Math.round(audioDuration)}s. Procesando en ${totalSegments} segmentos`);

      const model = await getTranscriber();

      for (let i = 0; i < totalSegments; i++) {
        console.log(`🔵 Segmento ${i + 1}/${totalSegments}`);

        const segmentPcmPath = join(process.cwd(), `segment-${timestamp}-${i}.pcm`);
        execSync(`ffmpeg -f f32le -ar 16000 -ac 1 -i "${pcmPath}" -ss ${i * SEGMENT_DURATION} -t ${SEGMENT_DURATION} -f f32le "${segmentPcmPath}" -y`, {
          stdio: 'pipe'
        });

        const segmentBuffer = readFileSync(segmentPcmPath);
        const segmentAudio = new Float32Array(segmentBuffer.buffer, segmentBuffer.byteOffset, segmentBuffer.length / 4);

        const segmentResult = await model(segmentAudio, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: false,
          task: 'transcribe',
          sampling_rate: 16000
        });

        fullTranscription += segmentResult.text + ' ';

        try {
          unlinkSync(segmentPcmPath);
        } catch (err) {
          console.error('Error al eliminar segmento:', err);
        }

        console.log(`✅ Segmento ${i + 1}/${totalSegments} completado`);
      }

      try {
        unlinkSync(pcmPath);
      } catch (err) {
        console.error('Error al eliminar PCM temporal:', err);
      }

    } else {
      // Audio normal
      const pcmBuffer = readFileSync(pcmPath);
      const float32Audio = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 4);

      try {
        unlinkSync(pcmPath);
      } catch (err) {
        console.error('Error al eliminar PCM temporal:', err);
      }

      const totalChunks = Math.ceil(audioDuration / 20);
      console.log(`📊 Audio: ${Math.round(audioDuration)}s (${totalChunks} chunks)`);
      console.log(`🔵 Transcribiendo audio...`);

      const model = await getTranscriber();

      let chunksProcessed = 0;
      const result = await model(float32Audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
        task: 'transcribe',
        sampling_rate: 16000,
        chunk_callback: (_chunk: any) => {
          chunksProcessed++;
          const percent = Math.round((chunksProcessed / totalChunks) * 100);
          console.log(`⏳ Transcribiendo: ${percent}% (chunk ${chunksProcessed}/${totalChunks})`);
        }
      });

      fullTranscription = result.text;
    }

    console.log(`✅ Transcripción completa (100%)`);
    console.log(`📏 Longitud del texto: ${fullTranscription.length} caracteres`);

    try {
      unlinkSync(outputPath);
      console.log(`🗑️ Archivo temporal eliminado: ${outputPath}`);
    } catch (err) {
      console.error('Error al eliminar archivo temporal:', err);
    }

    const filename = `transcription-${timestamp}`;
    const txtPath = join(TRANSCRIPTIONS_DIR, `${filename}.txt`);
    const jsonPath = join(TRANSCRIPTIONS_DIR, `${filename}.json`);

    writeFileSync(txtPath, fullTranscription, 'utf-8');
    console.log(`💾 Guardado: ${txtPath}`);

    const jsonData = {
      url,
      timestamp: new Date().toISOString(),
      text: fullTranscription,
      length: fullTranscription.length
    };
    writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    console.log(`💾 Guardado: ${jsonPath}`);

    res.json({
      text: fullTranscription,
      success: true,
      files: {
        txt: txtPath,
        json: jsonPath
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);

    if (outputPath) {
      try {
        unlinkSync(outputPath);
      } catch (err) {
        // Ignorar
      }
    }

    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
