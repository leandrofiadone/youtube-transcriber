import express, { Request, Response } from 'express';
import cors from 'cors';
import youtubedl from 'youtube-dl-exec';
import { unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from '@xenova/transformers';
// @ts-ignore
import { WaveFile } from 'wavefile';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Inicializar el modelo Whisper (se carga una sola vez)
let transcriber: any = null;

async function getTranscriber() {
  if (!transcriber) {
    console.log('🔵 Cargando modelo Whisper...');
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    console.log('✅ Modelo Whisper cargado');
  }
  return transcriber;
}

app.post('/api/transcribe', async (req: Request, res: Response) => {
  let outputPath: string | null = null;

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL es requerida' });
    }

    console.log(`🔵 Descargando audio de: ${url}`);

    // Generar nombre de archivo temporal
    const timestamp = Date.now();
    outputPath = join(process.cwd(), `audio-${timestamp}.wav`);

    // Descargar audio con yt-dlp en formato WAV 16kHz mono
    await youtubedl(url, {
      extractAudio: true,
      audioFormat: 'wav',
      output: outputPath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      postprocessorArgs: 'ffmpeg:-ar 16000 -ac 1',
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0'
      ]
    });

    console.log(`✅ Audio descargado: ${outputPath}`);

    // Leer el archivo WAV y convertirlo a Float32Array
    console.log(`🔵 Procesando archivo de audio...`);
    const wavBuffer = readFileSync(outputPath);
    const wav = new WaveFile(wavBuffer);
    wav.toBitDepth('32f'); // Convertir a 32-bit float
    wav.toSampleRate(16000); // Asegurar 16kHz

    let audioData = wav.getSamples();
    if (Array.isArray(audioData)) {
      // Si es estéreo, tomar solo el primer canal
      audioData = audioData[0];
    }

    // Convertir a Float32Array
    const float32Audio = new Float32Array(audioData);

    // Obtener el transcriber
    console.log(`🔵 Transcribiendo audio...`);
    const transcriber = await getTranscriber();

    // Transcribir el audio pasando directamente el Float32Array
    const result = await transcriber(float32Audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      task: 'transcribe',
      sampling_rate: 16000
    });

    console.log(`✅ Transcripción completa`);
    console.log(`📏 Longitud del texto: ${result.text?.length || 0} caracteres`);

    // Eliminar archivo temporal
    try {
      unlinkSync(outputPath);
      console.log(`🗑️ Archivo temporal eliminado: ${outputPath}`);
    } catch (err) {
      console.error('Error al eliminar archivo temporal:', err);
    }

    // Retornar el texto transcrito
    res.json({
      text: result.text,
      success: true
    });

  } catch (error) {
    console.error('❌ Error:', error);

    // Intentar eliminar archivo temporal si existe
    if (outputPath) {
      try {
        unlinkSync(outputPath);
      } catch (err) {
        // Ignorar error de eliminación
      }
    }

    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
