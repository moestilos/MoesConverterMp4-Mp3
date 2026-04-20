import 'dotenv/config';
import path from 'node:path';

// backend/ siempre es CWD (npm scripts lo garantizan).
// Permite override con BACKEND_ROOT si se invoca desde otro lugar.
const backendRoot = path.resolve(process.env.BACKEND_ROOT ?? process.cwd());

function parseOrigins(raw: string | undefined): string[] | '*' {
  if (!raw || raw.trim() === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN ?? 'http://localhost:4321'),
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 1024 * 1024 * 1024),
  uploadDir: path.resolve(backendRoot, 'uploads'),
  outputDir: path.resolve(backendRoot, 'outputs'),
  fileTtlMs: Number(process.env.FILE_TTL_MS ?? 15 * 60 * 1000),
  ffmpegPath: process.env.FFMPEG_PATH,
} as const;
