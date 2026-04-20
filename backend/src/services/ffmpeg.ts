import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config.js';

if (config.ffmpegPath) {
  ffmpeg.setFfmpegPath(config.ffmpegPath);
}

export interface ProbeResult {
  durationSec: number;
  format: string;
  hasAudio: boolean;
  hasVideo: boolean;
}

export function probe(input: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) return reject(err);
      const streams = data.streams ?? [];
      resolve({
        durationSec: Number(data.format?.duration ?? 0),
        format: String(data.format?.format_name ?? ''),
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        hasVideo: streams.some((s) => s.codec_type === 'video'),
      });
    });
  });
}

export interface ConvertOptions {
  input: string;
  output: string;
  bitrate?: string;
  totalDurationSec?: number;
  onProgress?: (percent: number) => void;
}

export function convertToMp3({
  input,
  output,
  bitrate = '192k',
  totalDurationSec,
  onProgress,
}: ConvertOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate(bitrate)
      .format('mp3');

    cmd.on('progress', (p) => {
      if (!onProgress) return;
      let percent: number | undefined;
      if (typeof p.percent === 'number' && !Number.isNaN(p.percent)) {
        percent = p.percent;
      } else if (totalDurationSec && p.timemark) {
        const [h, m, s] = p.timemark.split(':').map(Number);
        const seconds = (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
        percent = (seconds / totalDurationSec) * 100;
      }
      if (typeof percent === 'number') {
        onProgress(Math.min(100, Math.max(0, percent)));
      }
    });

    cmd.on('error', (err) => reject(err));
    cmd.on('end', () => resolve());
    cmd.save(output);
  });
}
