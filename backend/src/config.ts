import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..', '..');

function parseOrigins(raw: string | undefined): string[] | '*' {
  if (!raw || raw.trim() === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN ?? 'http://localhost:4321'),
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 100 * 1024 * 1024),
  uploadDir: path.resolve(backendRoot, 'uploads'),
  outputDir: path.resolve(backendRoot, 'outputs'),
  fileTtlMs: Number(process.env.FILE_TTL_MS ?? 15 * 60 * 1000),
  ffmpegPath: process.env.FFMPEG_PATH,
} as const;
