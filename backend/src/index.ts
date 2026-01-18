import express, { Request, Response } from 'express';
import cors from 'cors';
import youtubedl from 'youtube-dl-exec';
import { createReadStream, unlinkSync } from 'fs';
import { join } from 'path';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.post('/api/download', async (req: Request, res: Response) => {
  let outputPath: string | null = null;

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL es requerida' });
    }

    console.log(`Descargando audio de: ${url}`);

    // Generar nombre de archivo temporal
    const timestamp = Date.now();
    outputPath = join(process.cwd(), `audio-${timestamp}.mp3`);

    // Descargar audio con yt-dlp
    await youtubedl(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 5, // 0-9, donde 5 es calidad media
      output: outputPath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0'
      ]
    });

    console.log(`Audio descargado: ${outputPath}`);

    // Configurar headers para streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');

    // Stream del archivo al cliente
    const fileStream = createReadStream(outputPath);

    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('Error en el stream:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al enviar el audio' });
      }
    });

    // Eliminar archivo temporal después de enviarlo
    fileStream.on('end', () => {
      if (outputPath) {
        try {
          unlinkSync(outputPath);
          console.log(`Archivo temporal eliminado: ${outputPath}`);
        } catch (err) {
          console.error('Error al eliminar archivo temporal:', err);
        }
      }
    });

  } catch (error) {
    console.error('Error:', error);

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
