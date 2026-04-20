import type { WhisperSize } from './transcribe';

type Stage =
  | 'idle'
  | 'ready'
  | 'progress'
  | 'done'
  | 'transcribing'
  | 'transcript'
  | 'error';

interface UploadResponse {
  jobId: string;
  name: string;
  size: number;
  durationSec: number;
}

interface Context {
  apiUrl: string;
  maxBytes: number;
  jobId: string | null;
  file: File | null;
  meta: UploadResponse | null;
  mp3Blob: Blob | null;
  eventSource: EventSource | null;
  xhr: XMLHttpRequest | null;
  transcribeAbort: AbortController | null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function formatDuration(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function sanitizeName(raw: string): string {
  return raw
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\-. ]+/g, '_')
    .slice(0, 120)
    .trim();
}

export function initConverter(): void {
  const root = document.getElementById('converter');
  if (!root) return;

  const apiUrl =
    root.getAttribute('data-api-url')?.replace(/\/$/, '') ??
    'http://localhost:4000';
  const maxMb = Number(root.getAttribute('data-max-mb') ?? 1024);
  const maxLabel =
    root.getAttribute('data-max-label') ??
    (maxMb >= 1024 ? `${maxMb / 1024} GB` : `${maxMb} MB`);
  const ctx: Context = {
    apiUrl,
    maxBytes: maxMb * 1024 * 1024,
    jobId: null,
    file: null,
    meta: null,
    mp3Blob: null,
    eventSource: null,
    xhr: null,
    transcribeAbort: null,
  };

  const $ = <T extends Element = HTMLElement>(sel: string) =>
    root.querySelector(sel) as T | null;
  const stages: Record<Stage, HTMLElement | null> = {
    idle: root.querySelector('[data-stage="idle"]'),
    ready: root.querySelector('[data-stage="ready"]'),
    progress: root.querySelector('[data-stage="progress"]'),
    done: root.querySelector('[data-stage="done"]'),
    transcribing: root.querySelector('[data-stage="transcribing"]'),
    transcript: root.querySelector('[data-stage="transcript"]'),
    error: root.querySelector('[data-stage="error"]'),
  };

  const dropzone = $<HTMLLabelElement>('#dropzone');
  const spotlight = $<HTMLElement>('#dropzone-spotlight');
  const fileInput = $<HTMLInputElement>('#file-input');
  const fileName = $('#file-name');
  const fileSize = $('#file-size');
  const fileDuration = $('#file-duration');
  const outputName = $<HTMLInputElement>('#output-name');
  const uploadStatus = $<HTMLElement>('#upload-status');
  const uploadLabel = $('#upload-label');
  const uploadPercent = $('#upload-percent');
  const uploadBar = $<HTMLElement>('#upload-bar');
  const uploadSub = $('#upload-sub');
  const btnConvert = $<HTMLButtonElement>('#btn-convert');
  const btnConvertLabel = $('#btn-convert-label');
  const btnCancel = $<HTMLButtonElement>('#btn-cancel');
  const btnCancel2 = $<HTMLButtonElement>('#btn-cancel-2');
  const btnDownload = $<HTMLButtonElement>('#btn-download');
  const btnAgain = $<HTMLButtonElement>('#btn-again');
  const btnAgain2 = $<HTMLButtonElement>('#btn-again-2');
  const btnRetry = $<HTMLButtonElement>('#btn-retry');
  const btnTranscribe = $<HTMLButtonElement>('#btn-transcribe');
  const btnTransCancel = $<HTMLButtonElement>('#btn-trans-cancel');
  const btnBackDone = $<HTMLButtonElement>('#btn-back-done');
  const btnCopyText = $<HTMLButtonElement>('#btn-copy-text');
  const btnDownloadTxt = $<HTMLButtonElement>('#btn-download-txt');
  const whisperModel = $<HTMLSelectElement>('#whisper-model');
  const whisperLang = $<HTMLSelectElement>('#whisper-lang');
  const progressLabel = $('#progress-label');
  const progressSub = $('#progress-sub');
  const progressPercent = $('#progress-percent');
  const progressBar = $<HTMLElement>('#progress-bar');
  const progressStage = $('#progress-stage');
  const transLabel = $('#trans-label');
  const transSub = $('#trans-sub');
  const transPercent = $('#trans-percent');
  const transBar = $<HTMLElement>('#trans-bar');
  const transStage = $('#trans-stage');
  const transMeta = $('#trans-meta');
  const transcriptText = $<HTMLTextAreaElement>('#transcript-text');
  const doneSub = $('#done-sub');
  const errorMsg = $('#error-msg');

  function setStage(s: Stage) {
    for (const key of Object.keys(stages) as Stage[]) {
      stages[key]?.classList.toggle('hidden', key !== s);
    }
  }

  function setProgress(pct: number, label?: string, sub?: string, stageTxt?: string) {
    const clamped = Math.min(100, Math.max(0, pct));
    if (progressBar) progressBar.style.width = `${clamped}%`;
    if (progressPercent) progressPercent.textContent = `${Math.floor(clamped)}%`;
    if (label && progressLabel) progressLabel.textContent = label;
    if (sub !== undefined && progressSub) progressSub.textContent = sub;
    if (stageTxt && progressStage) progressStage.textContent = stageTxt;
  }

  function setUploadProgress(pct: number, sub?: string) {
    const clamped = Math.min(100, Math.max(0, pct));
    if (uploadBar) uploadBar.style.width = `${clamped}%`;
    if (uploadPercent) uploadPercent.textContent = `${Math.floor(clamped)}%`;
    if (sub !== undefined && uploadSub) uploadSub.textContent = sub;
  }

  function setConvertEnabled(enabled: boolean) {
    if (!btnConvert) return;
    btnConvert.disabled = !enabled;
    if (btnConvertLabel) {
      btnConvertLabel.textContent = enabled ? 'Convertir a MP3' : 'Subiendo…';
    }
  }

  function setTransProgress(
    pct: number | null,
    label?: string,
    sub?: string,
    stageTxt?: string,
  ) {
    if (transBar) {
      if (pct === null) transBar.style.width = '100%';
      else transBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }
    if (transPercent) {
      transPercent.textContent = pct === null ? '…' : `${Math.floor(pct)}%`;
    }
    if (label && transLabel) transLabel.textContent = label;
    if (sub !== undefined && transSub) transSub.textContent = sub;
    if (stageTxt && transStage) transStage.textContent = stageTxt;
  }

  function showError(msg: string) {
    if (errorMsg) errorMsg.textContent = msg;
    setStage('error');
  }

  function resetAll() {
    ctx.jobId = null;
    ctx.file = null;
    ctx.meta = null;
    ctx.mp3Blob = null;
    if (ctx.eventSource) {
      ctx.eventSource.close();
      ctx.eventSource = null;
    }
    if (ctx.xhr) {
      ctx.xhr.abort();
      ctx.xhr = null;
    }
    if (ctx.transcribeAbort) {
      ctx.transcribeAbort.abort();
      ctx.transcribeAbort = null;
    }
    if (fileInput) fileInput.value = '';
    uploadStatus?.classList.add('hidden');
    setUploadProgress(0, '');
    setConvertEnabled(false);
    if (transcriptText) transcriptText.value = '';
    setStage('idle');
  }

  async function cancelRemoteJob(jobId: string) {
    try {
      await fetch(`${ctx.apiUrl}/api/jobs/${jobId}`, { method: 'DELETE' });
    } catch {
      /* silencioso */
    }
  }

  function handleFile(file: File) {
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      showError('Solo se aceptan archivos de audio o video.');
      return;
    }
    if (file.size > ctx.maxBytes) {
      showError(`El archivo supera ${maxLabel}.`);
      return;
    }
    ctx.file = file;
    if (fileName) fileName.textContent = file.name;
    if (fileSize) fileSize.textContent = formatBytes(file.size);
    if (outputName) outputName.value = sanitizeName(file.name) || 'audio';

    // Audio file → skip server roundtrip, go straight to "done" so the user
    // can download it back (pass-through) or transcribe locally.
    if (file.type.startsWith('audio/')) {
      handleAudioFile(file);
      return;
    }

    if (fileDuration) fileDuration.textContent = 'Analizando…';
    uploadStatus?.classList.remove('hidden');
    if (uploadLabel) uploadLabel.textContent = 'Subiendo archivo…';
    setUploadProgress(0, `0 / ${formatBytes(file.size)}`);
    setConvertEnabled(false);
    setStage('ready');
    uploadFile(file);
  }

  async function handleAudioFile(file: File) {
    ctx.mp3Blob = file;
    let durationSec = 0;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const actx = new Ctx();
      const buf = await actx.decodeAudioData(await file.arrayBuffer());
      durationSec = buf.duration;
      await actx.close();
    } catch {
      /* decode failed — seguimos sin duración */
    }
    ctx.meta = {
      jobId: 'local',
      name: file.name,
      size: file.size,
      durationSec,
    };
    if (fileDuration) fileDuration.textContent = formatDuration(durationSec);
    if (doneSub) {
      doneSub.textContent = `Audio listo (${formatBytes(file.size)}). Descarga o transcribe a texto.`;
    }
    const dlLabel = document.getElementById('btn-download-label');
    if (dlLabel) {
      const ext =
        file.name.includes('.')
          ? file.name.slice(file.name.lastIndexOf('.') + 1).toUpperCase()
          : 'audio';
      dlLabel.textContent = `Descargar ${ext}`;
    }
    setStage('done');
  }

  function uploadFile(file: File) {
    const xhr = new XMLHttpRequest();
    ctx.xhr = xhr;
    const form = new FormData();
    form.append('file', file);

    xhr.open('POST', `${ctx.apiUrl}/api/upload`);
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = (ev.loaded / ev.total) * 100;
      setUploadProgress(pct, `${formatBytes(ev.loaded)} / ${formatBytes(ev.total)}`);
    };
    xhr.upload.onload = () => {
      if (uploadLabel) uploadLabel.textContent = 'Analizando archivo…';
      setUploadProgress(100, 'Leyendo metadatos con FFmpeg…');
    };
    xhr.onload = () => {
      ctx.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as UploadResponse;
          ctx.meta = data;
          ctx.jobId = data.jobId;
          if (fileDuration) fileDuration.textContent = formatDuration(data.durationSec);
          if (uploadLabel) uploadLabel.textContent = 'Subida completada';
          setUploadProgress(100, 'Listo para convertir');
          setConvertEnabled(true);
        } catch {
          showError('Respuesta del servidor inválida.');
        }
      } else {
        let msg = 'Error al subir el archivo.';
        try {
          const data = JSON.parse(xhr.responseText);
          if (data?.error) msg = data.error;
        } catch {
          /* noop */
        }
        showError(msg);
      }
    };
    xhr.onerror = () => {
      ctx.xhr = null;
      showError('No se pudo conectar con el servidor.');
    };
    xhr.send(form);
  }

  function startConversion() {
    if (!ctx.jobId) {
      showError('El archivo aún no se ha subido. Espera un momento.');
      return;
    }
    setStage('progress');
    setProgress(0, 'Convirtiendo a MP3…', 'Iniciando FFmpeg', 'Conversión en curso');

    const es = new EventSource(`${ctx.apiUrl}/api/convert/${ctx.jobId}`);
    ctx.eventSource = es;

    es.addEventListener('progress', (ev) => {
      try {
        const { progress } = JSON.parse((ev as MessageEvent).data);
        setProgress(
          progress,
          'Convirtiendo a MP3…',
          `Procesado ${Math.floor(progress)}% del audio`,
          'Conversión en curso',
        );
      } catch {
        /* noop */
      }
    });

    es.addEventListener('done', async () => {
      setProgress(100, 'Finalizando…', 'Descargando audio convertido', 'Completado');
      es.close();
      ctx.eventSource = null;

      try {
        const blob = await fetchMp3Blob();
        ctx.mp3Blob = blob;
        if (doneSub) {
          doneSub.textContent = `Tu MP3 está preparado (${formatBytes(blob.size)}).`;
        }
        setStage('done');
      } catch (e) {
        showError(
          e instanceof Error ? e.message : 'No se pudo descargar el archivo.',
        );
      }
    });

    es.addEventListener('error', (ev) => {
      let msg = 'Error durante la conversión.';
      try {
        const data = JSON.parse((ev as MessageEvent).data ?? '{}');
        if (data?.error) msg = data.error;
      } catch {
        /* noop */
      }
      es.close();
      ctx.eventSource = null;
      showError(msg);
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      es.close();
      ctx.eventSource = null;
      showError('Se perdió la conexión con el servidor.');
    };
  }

  async function fetchMp3Blob(): Promise<Blob> {
    if (!ctx.jobId) throw new Error('Sin jobId.');
    const res = await fetch(`${ctx.apiUrl}/api/download/${ctx.jobId}`);
    if (!res.ok) throw new Error(`Descarga falló (${res.status}).`);
    return await res.blob();
  }

  function downloadFromBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download() {
    if (!ctx.mp3Blob) return;
    const raw = outputName?.value.trim() || ctx.meta?.name || 'audio';
    const name = sanitizeName(raw) || 'audio';
    // Si el archivo original era audio, preservamos la extensión original.
    const origExt =
      ctx.file?.type.startsWith('audio/') && ctx.file.name.includes('.')
        ? ctx.file.name.slice(ctx.file.name.lastIndexOf('.') + 1).toLowerCase()
        : 'mp3';
    const ext = /^[a-z0-9]{1,5}$/.test(origExt) ? origExt : 'mp3';
    downloadFromBlob(ctx.mp3Blob, `${name}.${ext}`);
  }

  async function startTranscribe() {
    if (!ctx.mp3Blob) {
      showError('No hay audio disponible para transcribir.');
      return;
    }
    const size = (whisperModel?.value as WhisperSize) ?? 'base';
    const lang = whisperLang?.value || undefined;

    setStage('transcribing');
    setTransProgress(null, 'Preparando Whisper…', 'Detectando WebGPU/WASM…', 'Cargando');

    const abort = new AbortController();
    ctx.transcribeAbort = abort;

    try {
      const { transcribeBlob } = await import('./transcribe');
      const result = await transcribeBlob({
        blob: ctx.mp3Blob,
        model: size,
        language: lang,
        signal: abort.signal,
        onProgress: (p) => {
          if (p.phase === 'loading-model') {
            const pct = typeof p.progress === 'number' ? p.progress : null;
            setTransProgress(
              pct,
              'Descargando modelo…',
              p.file
                ? `${p.file}${
                    pct !== null ? ` · ${Math.floor(pct)}%` : ''
                  }`
                : 'Primera vez — después irá instantáneo',
              'Cacheando en IndexedDB',
            );
          } else if (p.phase === 'decoding') {
            setTransProgress(null, 'Decodificando audio…', 'Preparando PCM 16 kHz mono', 'Procesando');
          } else if (p.phase === 'running') {
            setTransProgress(null, 'Transcribiendo…', 'Whisper procesando en tu dispositivo', 'En curso');
          }
        },
      });

      if (transcriptText) transcriptText.value = result.text.trim();
      if (transMeta) {
        const dur = ctx.meta?.durationSec
          ? formatDuration(ctx.meta.durationSec)
          : '—';
        const modelLabel = `whisper-${size}`;
        const langLabel = lang ?? 'auto';
        transMeta.textContent = `${modelLabel} · ${langLabel} · duración ${dur}`;
      }
      ctx.transcribeAbort = null;
      setStage('transcript');
    } catch (e) {
      ctx.transcribeAbort = null;
      if ((e as Error).name === 'AbortError') {
        setStage('done');
        return;
      }
      console.error(e);
      showError(
        e instanceof Error
          ? `Transcripción falló: ${e.message}`
          : 'Transcripción falló.',
      );
    }
  }

  function cancelTranscribe() {
    if (ctx.transcribeAbort) {
      ctx.transcribeAbort.abort();
      ctx.transcribeAbort = null;
    }
    setStage('done');
  }

  async function copyTranscript() {
    if (!transcriptText) return;
    try {
      await navigator.clipboard.writeText(transcriptText.value);
      const btn = btnCopyText;
      if (btn) {
        const prev = btn.innerHTML;
        btn.innerHTML =
          '<svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span class="hidden sm:inline">Copiado</span>';
        setTimeout(() => {
          btn.innerHTML = prev;
        }, 1500);
      }
    } catch {
      transcriptText.select();
      document.execCommand('copy');
    }
  }

  function downloadTranscript() {
    if (!transcriptText) return;
    const raw = outputName?.value.trim() || ctx.meta?.name || 'transcripcion';
    const name = sanitizeName(raw) || 'transcripcion';
    const blob = new Blob([transcriptText.value], {
      type: 'text/plain;charset=utf-8',
    });
    downloadFromBlob(blob, `${name}.txt`);
  }

  // --- Dropzone events ---
  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      fileInput?.click();
    }
  });
  dropzone?.addEventListener('mousemove', (e) => {
    if (!spotlight) return;
    const rect = dropzone.getBoundingClientRect();
    spotlight.style.setProperty('--x', `${e.clientX - rect.left}px`);
    spotlight.style.setProperty('--y', `${e.clientY - rect.top}px`);
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragging');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragging');
    }),
  );
  dropzone?.addEventListener('drop', (e) => {
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });

  btnConvert?.addEventListener('click', startConversion);
  btnDownload?.addEventListener('click', download);
  btnTranscribe?.addEventListener('click', startTranscribe);
  btnTransCancel?.addEventListener('click', cancelTranscribe);
  btnBackDone?.addEventListener('click', () => setStage('done'));
  btnCopyText?.addEventListener('click', copyTranscript);
  btnDownloadTxt?.addEventListener('click', downloadTranscript);

  const onCancel = async () => {
    if (ctx.jobId) await cancelRemoteJob(ctx.jobId);
    resetAll();
  };
  btnCancel?.addEventListener('click', onCancel);
  btnCancel2?.addEventListener('click', onCancel);
  btnAgain?.addEventListener('click', resetAll);
  btnAgain2?.addEventListener('click', resetAll);
  btnRetry?.addEventListener('click', onCancel);

  // Evita que el navegador abra archivo al soltar fuera del dropzone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
