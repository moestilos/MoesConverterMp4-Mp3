import { apiFetch } from './auth';

export interface TranscribeProgress {
  phase: 'uploading' | 'transcribing';
  uploadPct?: number;
}

export interface TranscribeOptions {
  blob: Blob;
  filename?: string;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (p: TranscribeProgress) => void;
}

export interface TranscribeResult {
  text: string;
  chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
}

export async function transcribeBlob(opts: TranscribeOptions): Promise<TranscribeResult> {
  const { blob, filename = 'audio.mp3', language, signal, onProgress } = opts;

  const form = new FormData();
  form.append('file', blob, filename);
  if (language) form.append('language', language);

  onProgress?.({ phase: 'uploading', uploadPct: 0 });

  // Upload with XHR to track upload progress, then wait for server response
  const result = await new Promise<TranscribeResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    signal?.addEventListener('abort', () => {
      xhr.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    });

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = (ev.loaded / ev.total) * 100;
      onProgress?.({ phase: 'uploading', uploadPct: pct });
    };

    xhr.upload.onload = () => {
      onProgress?.({ phase: 'transcribing' });
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as TranscribeResult);
        } else {
          reject(new Error(data?.error ?? `Error del servidor (${xhr.status}).`));
        }
      } catch {
        reject(new Error('Respuesta del servidor inválida.'));
      }
    };

    xhr.onerror = () => reject(new Error('No se pudo conectar con el servidor.'));
    xhr.ontimeout = () => reject(new Error('El servidor tardó demasiado en transcribir.'));

    const token = localStorage.getItem('moesconverter.token');
    const apiUrl = (import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

    xhr.open('POST', `${apiUrl}/api/transcribe`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 5 * 60 * 1000; // 5 min max
    xhr.send(form);
  });

  return result;
}
