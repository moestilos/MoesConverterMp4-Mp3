type Stage = 'idle' | 'ready' | 'progress' | 'done' | 'error';

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
  eventSource: EventSource | null;
  xhr: XMLHttpRequest | null;
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
    eventSource: null,
    xhr: null,
  };

  const $ = <T extends Element = HTMLElement>(sel: string) =>
    root.querySelector(sel) as T | null;
  const stages: Record<Stage, HTMLElement | null> = {
    idle: root.querySelector('[data-stage="idle"]'),
    ready: root.querySelector('[data-stage="ready"]'),
    progress: root.querySelector('[data-stage="progress"]'),
    done: root.querySelector('[data-stage="done"]'),
    error: root.querySelector('[data-stage="error"]'),
  };

  const dropzone = $<HTMLLabelElement>('#dropzone');
  const spotlight = $<HTMLElement>('#dropzone-spotlight');
  const fileInput = $<HTMLInputElement>('#file-input');
  const fileName = $('#file-name');
  const fileSize = $('#file-size');
  const fileDuration = $('#file-duration');
  const outputName = $<HTMLInputElement>('#output-name');
  const btnConvert = $<HTMLButtonElement>('#btn-convert');
  const btnCancel = $<HTMLButtonElement>('#btn-cancel');
  const btnCancel2 = $<HTMLButtonElement>('#btn-cancel-2');
  const btnDownload = $<HTMLButtonElement>('#btn-download');
  const btnAgain = $<HTMLButtonElement>('#btn-again');
  const btnRetry = $<HTMLButtonElement>('#btn-retry');
  const progressLabel = $('#progress-label');
  const progressSub = $('#progress-sub');
  const progressPercent = $('#progress-percent');
  const progressBar = $<HTMLElement>('#progress-bar');
  const progressStage = $('#progress-stage');
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

  function showError(msg: string) {
    if (errorMsg) errorMsg.textContent = msg;
    setStage('error');
  }

  function resetAll() {
    ctx.jobId = null;
    ctx.file = null;
    ctx.meta = null;
    if (ctx.eventSource) {
      ctx.eventSource.close();
      ctx.eventSource = null;
    }
    if (ctx.xhr) {
      ctx.xhr.abort();
      ctx.xhr = null;
    }
    if (fileInput) fileInput.value = '';
    setStage('idle');
  }

  async function cancelRemoteJob(jobId: string) {
    try {
      await fetch(`${ctx.apiUrl}/api/jobs/${jobId}`, { method: 'DELETE' });
    } catch { /* silencioso */ }
  }

  function handleFile(file: File) {
    if (!file.type.startsWith('video/')) {
      showError('Solo se aceptan archivos de video.');
      return;
    }
    if (file.size > ctx.maxBytes) {
      showError(`El archivo supera ${maxLabel}.`);
      return;
    }
    ctx.file = file;
    if (fileName) fileName.textContent = file.name;
    if (fileSize) fileSize.textContent = formatBytes(file.size);
    if (fileDuration) fileDuration.textContent = 'Analizando…';
    if (outputName) outputName.value = sanitizeName(file.name) || 'audio';
    setStage('ready');
    uploadFile(file);
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
      if (stages.progress && !stages.progress.classList.contains('hidden')) {
        setProgress(pct * 0.3, 'Subiendo archivo…',
          `${formatBytes(ev.loaded)} / ${formatBytes(ev.total)}`,
          'Fase 1 de 2 · Subida');
      }
    };
    xhr.onload = () => {
      ctx.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as UploadResponse;
          ctx.meta = data;
          ctx.jobId = data.jobId;
          if (fileDuration) fileDuration.textContent = formatDuration(data.durationSec);
        } catch {
          showError('Respuesta del servidor inválida.');
        }
      } else {
        let msg = 'Error al subir el archivo.';
        try {
          const data = JSON.parse(xhr.responseText);
          if (data?.error) msg = data.error;
        } catch { /* noop */ }
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
    setProgress(30, 'Convirtiendo a MP3…', 'FFmpeg procesando audio', 'Fase 2 de 2 · Conversión');

    const es = new EventSource(`${ctx.apiUrl}/api/convert/${ctx.jobId}`);
    ctx.eventSource = es;

    es.addEventListener('progress', (ev) => {
      try {
        const { progress } = JSON.parse((ev as MessageEvent).data);
        const mapped = 30 + (progress / 100) * 70;
        setProgress(mapped, 'Convirtiendo a MP3…',
          `Procesado ${Math.floor(progress)}% del audio`,
          'Fase 2 de 2 · Conversión');
      } catch { /* noop */ }
    });

    es.addEventListener('done', () => {
      setProgress(100, 'Finalizando…', 'Listo', 'Completado');
      es.close();
      ctx.eventSource = null;
      setTimeout(() => setStage('done'), 400);
    });

    es.addEventListener('error', (ev) => {
      let msg = 'Error durante la conversión.';
      try {
        const data = JSON.parse((ev as MessageEvent).data ?? '{}');
        if (data?.error) msg = data.error;
      } catch { /* noop */ }
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

  function download() {
    if (!ctx.jobId) return;
    const raw = outputName?.value.trim() || ctx.meta?.name || 'audio';
    const name = sanitizeName(raw) || 'audio';
    const url = `${ctx.apiUrl}/api/download/${ctx.jobId}?filename=${encodeURIComponent(name)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  const onCancel = async () => {
    if (ctx.jobId) await cancelRemoteJob(ctx.jobId);
    resetAll();
  };
  btnCancel?.addEventListener('click', onCancel);
  btnCancel2?.addEventListener('click', onCancel);
  btnAgain?.addEventListener('click', onCancel);
  btnRetry?.addEventListener('click', onCancel);

  // Protección: evitar que el navegador abra el archivo si el usuario suelta fuera del dropzone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
