// Browser-side transcription with @huggingface/transformers.
// Runs Whisper locally in the user's browser. No server cost, no data leaves
// the device. First run downloads the model (~75 MB for "base", ~250 MB for
// "small"), cached in IndexedDB for subsequent runs.

export type WhisperSize = 'tiny' | 'base' | 'small';

export interface TranscribeProgress {
  phase: 'loading-model' | 'decoding' | 'running';
  file?: string;
  progress?: number;
  total?: number;
  loaded?: number;
}

export interface TranscribeOptions {
  blob: Blob;
  model?: WhisperSize;
  language?: string;
  onProgress?: (p: TranscribeProgress) => void;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
}

const MODEL_IDS: Record<WhisperSize, string> = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
};

let pipelineCache: { key: string; instance: unknown } | null = null;

async function decodeAudio(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<Float32Array> {
  onProgress?.({ phase: 'decoding' });
  const arrayBuffer = await blob.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  // Whisper expects 16 kHz mono
  const ctx = new Ctx({ sampleRate: 16000 });
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  let mono: Float32Array;
  if (audioBuffer.numberOfChannels === 1) {
    mono = audioBuffer.getChannelData(0);
  } else {
    const l = audioBuffer.getChannelData(0);
    const r = audioBuffer.getChannelData(1);
    mono = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2;
  }
  await ctx.close();
  return mono;
}

export async function transcribeBlob(
  opts: TranscribeOptions,
): Promise<TranscribeResult> {
  const model: WhisperSize = opts.model ?? 'base';
  const modelId = MODEL_IDS[model];

  const { pipeline, env } = await import('@huggingface/transformers');
  // Use quantized + WebGPU when available, fallback WASM.
  env.allowRemoteModels = true;

  let transcriber: any;
  if (pipelineCache && pipelineCache.key === modelId) {
    transcriber = pipelineCache.instance;
  } else {
    let device: 'webgpu' | 'wasm' = 'wasm';
    try {
      if ('gpu' in navigator) {
        // @ts-expect-error experimental
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) device = 'webgpu';
      }
    } catch {
      device = 'wasm';
    }

    transcriber = await pipeline('automatic-speech-recognition', modelId, {
      device,
      dtype: device === 'webgpu' ? 'fp32' : 'q8',
      progress_callback: (p: {
        status: string;
        name?: string;
        file?: string;
        progress?: number;
        loaded?: number;
        total?: number;
      }) => {
        if (
          p.status === 'progress' ||
          p.status === 'download' ||
          p.status === 'initiate'
        ) {
          opts.onProgress?.({
            phase: 'loading-model',
            file: p.file,
            progress: p.progress,
            loaded: p.loaded,
            total: p.total,
          });
        }
      },
    });
    pipelineCache = { key: modelId, instance: transcriber };
  }

  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const audio = await decodeAudio(opts.blob, opts.onProgress);
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  opts.onProgress?.({ phase: 'running' });
  const output = await transcriber(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: opts.language ?? null,
    task: 'transcribe',
    return_timestamps: true,
  });

  return {
    text: Array.isArray(output) ? output[0].text : output.text,
    chunks: (output as { chunks?: TranscribeResult['chunks'] }).chunks,
  };
}
