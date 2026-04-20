import { Router, type Request, type Response } from 'express';
import { sql, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  comparePassword,
  hashPassword,
  requireAuth,
} from '../services/auth.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/profile', async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  const stats = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM ${schema.conversions}
         WHERE user_id = ${userId}) AS conversions,
      (SELECT COUNT(*)::int FROM ${schema.downloads}
         WHERE user_id = ${userId}) AS downloads,
      (SELECT COUNT(*)::int FROM ${schema.transcriptions}
         WHERE user_id = ${userId}) AS transcriptions,
      (SELECT COALESCE(SUM(source_size), 0)::bigint FROM ${schema.conversions}
         WHERE user_id = ${userId}) AS bytes_in,
      (SELECT COALESCE(SUM(output_size), 0)::bigint FROM ${schema.conversions}
         WHERE user_id = ${userId}) AS bytes_out,
      (SELECT COALESCE(SUM(duration_sec), 0)::int FROM ${schema.conversions}
         WHERE user_id = ${userId}) AS seconds_audio,
      (SELECT COALESCE(SUM(chars), 0)::int FROM ${schema.transcriptions}
         WHERE user_id = ${userId}) AS chars_transcribed
  `);
  const row = (stats.rows[0] ?? {}) as Record<string, number | string>;

  res.json({
    user,
    stats: {
      conversions: Number(row.conversions ?? 0),
      downloads: Number(row.downloads ?? 0),
      transcriptions: Number(row.transcriptions ?? 0),
      bytesIn: Number(row.bytes_in ?? 0),
      bytesOut: Number(row.bytes_out ?? 0),
      secondsAudio: Number(row.seconds_audio ?? 0),
      charsTranscribed: Number(row.chars_transcribed ?? 0),
    },
  });
});

meRouter.get('/activity', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);

  const rows = await db.execute(sql`
    SELECT type, created_at, detail FROM (
      SELECT 'conversion'::text AS type, created_at,
        json_build_object('jobId', job_id, 'sourceSize', source_size, 'outputSize', output_size, 'durationSec', duration_sec) AS detail
        FROM ${schema.conversions} WHERE user_id = ${userId}
      UNION ALL
      SELECT 'download'::text, created_at,
        json_build_object('jobId', job_id, 'filename', filename, 'size', size) AS detail
        FROM ${schema.downloads} WHERE user_id = ${userId}
      UNION ALL
      SELECT 'transcription'::text, created_at,
        json_build_object('model', model, 'language', language, 'chars', chars) AS detail
        FROM ${schema.transcriptions} WHERE user_id = ${userId}
    ) AS activity
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  res.json({ activity: rows.rows });
});

meRouter.get('/timeseries', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const metric = String(req.query.metric ?? 'conversions');
  const days = Math.min(Math.max(Number(req.query.days ?? 14), 1), 90);

  const tableMap: Record<string, string> = {
    conversions: 'conversions',
    downloads: 'downloads',
    transcriptions: 'transcriptions',
  };
  const tableName = tableMap[metric];
  if (!tableName) {
    return res.status(400).json({ error: 'metric inválido' });
  }

  const rows = await db.execute(sql`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', NOW()) - ((${days} - 1) || ' days')::interval,
        date_trunc('day', NOW()),
        '1 day'::interval
      ) AS day
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      COALESCE(COUNT(t.id), 0)::int AS count
    FROM days d
    LEFT JOIN ${sql.raw(tableName)} t
      ON date_trunc('day', t.created_at) = d.day
      AND t.user_id = ${userId}
    GROUP BY d.day
    ORDER BY d.day ASC
  `);

  res.json({ metric, days, series: rows.rows });
});

meRouter.post('/password', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const { currentPassword, newPassword } = (req.body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof currentPassword !== 'string' ||
    typeof newPassword !== 'string' ||
    newPassword.length < 6
  ) {
    return res
      .status(400)
      .json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  const ok = await comparePassword(currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta.' });
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(schema.users)
    .set({ passwordHash })
    .where(eq(schema.users.id, userId));

  res.json({ ok: true });
});
