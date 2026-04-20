import fs from 'node:fs/promises';
import { config } from '../config.js';
import { listJobs, deleteJob } from '../services/jobs.js';

export async function safeUnlink(p?: string): Promise<void> {
  if (!p) return;
  try {
    await fs.unlink(p);
  } catch {
    /* archivo ya eliminado o inaccesible */
  }
}

export function startCleanupLoop(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(async () => {
    const now = Date.now();
    for (const job of listJobs()) {
      if (now - job.createdAt > config.fileTtlMs) {
        await safeUnlink(job.inputPath);
        await safeUnlink(job.outputPath);
        deleteJob(job.id);
      }
    }
  }, intervalMs);
}
