import { Router, type Request, type Response } from 'express';
import { db, schema } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../services/auth.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/overview', async (_req: Request, res: Response) => {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [usersCount, conversionsCount, downloadsCount, transcriptionsCount] =
    await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS count FROM ${schema.users}`),
      db.execute(
        sql`SELECT COUNT(*)::int AS count FROM ${schema.conversions}`,
      ),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM ${schema.downloads}`),
      db.execute(
        sql`SELECT COUNT(*)::int AS count FROM ${schema.transcriptions}`,
      ),
    ]);

  const [uniqueIps24h, uniqueIps7d, visits24h, visits7d] = await Promise.all([
    db.execute(
      sql`SELECT COUNT(DISTINCT ip)::int AS count FROM ${schema.visits} WHERE created_at >= ${since24h.toISOString()}`,
    ),
    db.execute(
      sql`SELECT COUNT(DISTINCT ip)::int AS count FROM ${schema.visits} WHERE created_at >= ${since7d.toISOString()}`,
    ),
    db.execute(
      sql`SELECT COUNT(*)::int AS count FROM ${schema.visits} WHERE created_at >= ${since24h.toISOString()}`,
    ),
    db.execute(
      sql`SELECT COUNT(*)::int AS count FROM ${schema.visits} WHERE created_at >= ${since7d.toISOString()}`,
    ),
  ]);

  const pick = (r: { rows: unknown[] }): number => {
    const row = r.rows?.[0] as { count?: number } | undefined;
    return row?.count ?? 0;
  };

  res.json({
    users: pick(usersCount),
    conversions: pick(conversionsCount),
    downloads: pick(downloadsCount),
    transcriptions: pick(transcriptionsCount),
    uniqueIps24h: pick(uniqueIps24h),
    uniqueIps7d: pick(uniqueIps7d),
    visits24h: pick(visits24h),
    visits7d: pick(visits7d),
  });
});

adminRouter.get('/users', async (_req: Request, res: Response) => {
  const rows = await db.execute(
    sql`
      SELECT
        u.id,
        u.email,
        u.username,
        u.role,
        u.created_at,
        COALESCE(c.cnt, 0)::int AS conversions,
        COALESCE(d.cnt, 0)::int AS downloads,
        COALESCE(t.cnt, 0)::int AS transcriptions
      FROM ${schema.users} u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM ${schema.conversions} GROUP BY user_id
      ) c ON c.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM ${schema.downloads} GROUP BY user_id
      ) d ON d.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM ${schema.transcriptions} GROUP BY user_id
      ) t ON t.user_id = u.id
      ORDER BY u.created_at DESC
      LIMIT 200
    `,
  );
  res.json({ users: rows.rows });
});

adminRouter.get('/timeseries', async (req: Request, res: Response) => {
  const metric = String(req.query.metric ?? 'visits');
  const days = Math.min(Math.max(Number(req.query.days ?? 14), 1), 90);

  const tableMap: Record<string, { table: string; extra?: string }> = {
    visits: { table: 'visits' },
    conversions: { table: 'conversions' },
    downloads: { table: 'downloads' },
    transcriptions: { table: 'transcriptions' },
    unique_ips: { table: 'visits', extra: 'DISTINCT ip' },
  };
  const spec = tableMap[metric];
  if (!spec) return res.status(400).json({ error: 'metric inválido' });

  const expr = spec.extra ? sql.raw(`COUNT(${spec.extra})`) : sql`COUNT(*)`;
  const table = sql.raw(spec.table);

  const rows = await db.execute(
    sql`
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        ${expr}::int AS count
      FROM ${table}
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  );

  res.json({ metric, days, series: rows.rows });
});

adminRouter.get('/visits/top-ips', async (req: Request, res: Response) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 90);
  const rows = await db.execute(
    sql`
      SELECT ip, COUNT(*)::int AS hits, MAX(created_at) AS last_seen
      FROM ${schema.visits}
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY ip
      ORDER BY hits DESC
      LIMIT 25
    `,
  );
  res.json({ days, ips: rows.rows });
});
