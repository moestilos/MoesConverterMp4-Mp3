import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import Groq from 'groq-sdk';
import { config } from '../config.js';
import { requireAuth } from '../services/auth.js';
import { db, schema } from '../db/index.js';
import { safeUnlink } from '../utils/cleanup.js';

export const transcribeRouter = Router();
transcribeRouter.use(requireAuth);

const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

let groq: Groq | null = null;
if (config.groqApiKey) {
  groq = new Groq({ apiKey: config.groqApiKey });
}

const SUPPORTED_LANGS = new Set([
  'af','ar','hy','az','be','bs','bg','ca','zh','hr','cs','da','nl',
  'en','et','fi','fr','gl','de','el','he','hi','hu','is','id','it',
  'ja','kn','kk','ko','lv','lt','mk','ms','mr','mi','ne','no','fa',
  'pl','pt','ro','ru','sr','sk','sl','es','sw','sv','tl','ta','th',
  'tr','uk','ur','vi','cy',
]);

transcribeRouter.post('/', (req: Request, res: Response) => {
  if (!groq) {
    return res.status(503).json({
      error: 'Transcripción no configurada. Añade GROQ_API_KEY en el servidor.',
    });
  }

  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: err.message,
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo de audio.' });
    }

    const rawLang = typeof req.body?.language === 'string' ? req.body.language.trim().toLowerCase() : '';
    const language = SUPPORTED_LANGS.has(rawLang) ? rawLang : undefined;

    const ext = path.extname(req.file.originalname || '.mp3') || '.mp3';
    const filePath = req.file.path;

    try {
      const fileStream = fs.createReadStream(filePath);
      // Groq needs filename to detect audio format
      Object.defineProperty(fileStream, 'name', { value: `audio${ext}` });

      type VerboseResponse = Groq.Audio.Transcription & {
        segments?: Array<{ start: number; end: number; text: string }>;
      };

      const result = await (groq!.audio.transcriptions.create({
        file: fileStream as unknown as File,
        model: 'whisper-large-v3-turbo',
        ...(language ? { language } : {}),
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      }) as Promise<VerboseResponse>);

      const userId = req.user?.sub;
      if (userId) {
        db.insert(schema.transcriptions).values({
          userId,
          model: 'whisper-large-v3-turbo',
          language: language ?? 'auto',
          chars: result.text.length,
        }).catch(() => {});
      }

      res.json({
        text: result.text,
        chunks: result.segments?.map((s) => ({
          timestamp: [s.start, s.end] as [number, number],
          text: s.text,
        })),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error en transcripción.';
      res.status(500).json({ error: msg });
    } finally {
      safeUnlink(filePath);
    }
  });
});
