import { nanoid } from 'nanoid';

export type JobStatus = 'uploaded' | 'converting' | 'ready' | 'error';

export interface Job {
  id: string;
  originalName: string;
  size: number;
  durationSec: number;
  inputPath: string;
  outputPath?: string;
  status: JobStatus;
  progress: number;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();

export function createJob(
  data: Pick<Job, 'originalName' | 'size' | 'durationSec' | 'inputPath'>,
): Job {
  const job: Job = {
    id: nanoid(14),
    status: 'uploaded',
    progress: 0,
    createdAt: Date.now(),
    ...data,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, patch);
  return job;
}

export function deleteJob(id: string): void {
  jobs.delete(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()];
}
