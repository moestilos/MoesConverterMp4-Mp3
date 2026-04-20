import { Router, type Request, type Response } from 'express';
import { db, schema } from '../db/index.js';
import { verifyToken } from '../services/auth.js';

export const trackRouter = Router();

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

function maybeUserId(req: Request): number | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  const payload = verifyToken(h.slice(7).trim());
  return payload?.sub ?? null;
}

trackRouter.post('/visit', async (req: Request, res: Response) => {
  const path = typeof req.body?.path === 'string' ? req.body.path.slice(0, 255) : '/';
  const ua = req.headers['user-agent']?.toString().slice(0, 500) ?? null;
  const userId = maybeUserId(req);
  try {
    await db.insert(schema.visits).values({
      ip: clientIp(req),
      userAgent: ua,
      path,
      userId,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[track/visit]', e);
    res.json({ ok: false });
  }
});

trackRouter.post('/transcription', async (req: Request, res: Response) => {
  const userId = maybeUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  const { model, language, chars } = (req.body ?? {}) as Record<string, unknown>;
  try {
    await db.insert(schema.transcriptions).values({
      userId,
      model: typeof model === 'string' ? model.slice(0, 32) : null,
      language: typeof language === 'string' ? language.slice(0, 32) : null,
      chars: typeof chars === 'number' ? Math.max(0, Math.floor(chars)) : null,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[track/transcription]', e);
    res.json({ ok: false });
  }
});
