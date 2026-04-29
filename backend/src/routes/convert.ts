import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { createJob, getJob, updateJob, deleteJob } from '../services/jobs.js';
import { probe, convertToMp3 } from '../services/ffmpeg.js';
import { safeUnlink } from '../utils/cleanup.js';
import { requireAuth, verifyToken } from '../services/auth.js';
import { db, schema } from '../db/index.js';

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const rand = Math.random().toString(36).slice(2, 10);
    cb(null, `${Date.now()}-${rand}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      return cb(new Error('Solo se permiten archivos de video.'));
    }
    cb(null, true);
  },
});

export const router = Router();

router.use(requireAuth);

router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se recibio ningun archivo.' });
      }
      const info = await probe(req.file.path).catch(() => null);
      if (!info || !info.hasAudio) {
        await safeUnlink(req.file.path);
        return res
          .status(400)
          .json({ error: 'Archivo invalido o sin pista de audio.' });
      }
      const job = createJob({
        originalName: req.file.originalname,
        size: req.file.size,
        durationSec: info.durationSec,
        inputPath: req.file.path,
      });
      res.json({
        jobId: job.id,
        name: job.originalName,
        size: job.size,
        durationSec: job.durationSec,
      });
    } catch (e) {
      next(e);
    }
  });
});

router.get('/convert/:id', (req: Request, res: Response) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    return res.status(404).json({ error: 'Job no encontrado.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  req.on('close', () => clearInterval(heartbeat));

  if (job.status === 'ready') {
    send('progress', { progress: 100 });
    send('done', { jobId: job.id });
    clearInterval(heartbeat);
    return res.end();
  }
  if (job.status === 'error') {
    send('error', { error: job.error ?? 'Error desconocido.' });
    clearInterval(heartbeat);
    return res.end();
  }
  if (job.status === 'converting') {
    send('progress', { progress: job.progress });
    const poll = setInterval(() => {
      const j = getJob(String(req.params.id));
      if (!j) {
        send('error', { error: 'Job no encontrado.' });
        clearInterval(poll);
        clearInterval(heartbeat);
        res.end();
        return;
      }
      if (j.status === 'ready') {
        send('progress', { progress: 100 });
        send('done', { jobId: j.id });
        clearInterval(poll);
        clearInterval(heartbeat);
        res.end();
      } else if (j.status === 'error') {
        send('error', { error: j.error ?? 'Error desconocido.' });
        clearInterval(poll);
        clearInterval(heartbeat);
        res.end();
      } else {
        send('progress', { progress: j.progress });
      }
    }, 500);
    req.on('close', () => clearInterval(poll));
    return;
  }

  const outputPath = path.join(config.outputDir, `${job.id}.mp3`);
  updateJob(job.id, { status: 'converting', progress: 0, outputPath });
  send('progress', { progress: 0 });

  convertToMp3({
    input: job.inputPath,
    output: outputPath,
    totalDurationSec: job.durationSec,
    onProgress: (p) => {
      updateJob(job.id, { progress: p });
      send('progress', { progress: p });
    },
  })
    .then(async () => {
      updateJob(job.id, { status: 'ready', progress: 100 });
      send('progress', { progress: 100 });
      send('done', { jobId: job.id });
      clearInterval(heartbeat);
      res.end();
      const userId = req.user?.sub;
      if (userId) {
        try {
          const outStat = fs.statSync(outputPath);
          await db.insert(schema.conversions).values({
            userId,
            jobId: job.id,
            sourceSize: job.size,
            outputSize: outStat.size,
            durationSec: Math.round(job.durationSec),
          });
        } catch (err) {
          console.error('[convert/log]', err);
        }
      }
    })
    .catch((err: Error) => {
      updateJob(job.id, { status: 'error', error: err.message });
      send('error', { error: err.message });
      clearInterval(heartbeat);
      res.end();
    });
});

router.get('/download/:id', (req: Request, res: Response) => {
  const job = getJob(String(req.params.id));
  if (!job || job.status !== 'ready' || !job.outputPath) {
    return res.status(404).json({ error: 'Archivo no disponible.' });
  }

  const rawName =
    (typeof req.query.filename === 'string' && req.query.filename) ||
    job.originalName.replace(/\.[^.]+$/, '');
  const safeName =
    rawName.replace(/[^\w\-. ]+/g, '_').slice(0, 120).trim() || 'audio';

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}.mp3"`,
  );
  try {
    res.setHeader('Content-Length', fs.statSync(job.outputPath).size);
  } catch { /* noop */ }

  const stream = fs.createReadStream(job.outputPath);
  stream.on('error', () => res.end());
  stream.pipe(res);

  const userId = req.user?.sub;
  const outputPath = job.outputPath;
  let size = 0;
  try {
    size = fs.statSync(outputPath).size;
  } catch {
    /* noop */
  }

  res.on('close', async () => {
    if (userId) {
      try {
        await db.insert(schema.downloads).values({
          userId,
          jobId: job.id,
          filename: `${safeName}.mp3`,
          size,
        });
      } catch (err) {
        console.error('[download/log]', err);
      }
    }
    await safeUnlink(job.inputPath);
    await safeUnlink(outputPath);
    deleteJob(job.id);
  });
});

router.delete('/jobs/:id', async (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  await safeUnlink(job.inputPath);
  await safeUnlink(job.outputPath);
  deleteJob(job.id);
  res.json({ ok: true });
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    name: job.originalName,
    size: job.size,
    durationSec: job.durationSec,
    error: job.error,
  });
});
