import type { TranscribeResult } from './transcribe';
import { getToken, trackTranscription } from './auth';
import { toastError, toastSuccess } from './toast';

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
  mp3Url: string | null;
  eventSource: EventSource | null;
  xhr: XMLHttpRequest | null;
  transcribeAbort: AbortController | null;
  transcript: TranscribeResult | null;
  transcriptLang: string;
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
    mp3Url: null,
    eventSource: null,
    xhr: null,
    transcribeAbort: null,
    transcript: null,
    transcriptLang: '',
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
  const whisperLang = $<HTMLSelectElement>('#whisper-lang');
  const btnTranscribe = $<HTMLButtonElement>('#btn-transcribe');
  const btnPlay = $<HTMLButtonElement>('#btn-play');
  const iconPlay = $<HTMLElement>('#icon-play');
  const iconPause = $<HTMLElement>('#icon-pause');
  const audioEl = $<HTMLAudioElement>('#audio-el');
  const audioSeek = $<HTMLInputElement>('#audio-seek');
  const audioTime = $('#audio-time');
  const audioTotal = $('#audio-total');
  const audioPreview = $<HTMLElement>('#audio-preview');
  const btnExportToggle = $<HTMLButtonElement>('#btn-export-toggle');
  const exportMenu = $<HTMLElement>('#export-menu');
  const exportOpts = root.querySelectorAll<HTMLButtonElement>('.export-opt');
  const btnTransCancel = $<HTMLButtonElement>('#btn-trans-cancel');
  const btnBackDone = $<HTMLButtonElement>('#btn-back-done');
  const btnCopyText = $<HTMLButtonElement>('#btn-copy-text');
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
    toastError('Algo falló', msg);
  }

  function resetAll() {
    ctx.jobId = null;
    ctx.file = null;
    ctx.meta = null;
    ctx.mp3Blob = null;
    if (ctx.mp3Url) {
      URL.revokeObjectURL(ctx.mp3Url);
      ctx.mp3Url = null;
    }
    ctx.transcript = null;
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
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
    }
    audioPreview?.classList.add('hidden');
    exportMenu?.classList.add('hidden');
    uploadStatus?.classList.add('hidden');
    setUploadProgress(0, '');
    setConvertEnabled(false);
    if (transcriptText) transcriptText.value = '';
    setStage('idle');
  }

  async function cancelRemoteJob(jobId: string) {
    try {
      const tok = getToken();
      await fetch(`${ctx.apiUrl}/api/jobs/${jobId}`, {
        method: 'DELETE',
        headers: tok ? { Authorization: `Bearer ${tok}` } : undefined,
      });
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
    attachAudioPreview(file);
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
    const tok = getToken();
    if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);
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

    const tok = getToken();
    const tokenQs = tok ? `?token=${encodeURIComponent(tok)}` : '';
    const es = new EventSource(
      `${ctx.apiUrl}/api/convert/${ctx.jobId}${tokenQs}`,
    );
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
        attachAudioPreview(blob);
        setStage('done');
        toastSuccess('Conversión lista', `MP3 ${formatBytes(blob.size)} preparado.`);
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
    const tok = getToken();
    const res = await fetch(`${ctx.apiUrl}/api/download/${ctx.jobId}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : undefined,
    });
    if (!res.ok) throw new Error(`Descarga falló (${res.status}).`);
    return await res.blob();
  }

  function attachAudioPreview(blob: Blob) {
    if (!audioEl || !audioPreview) return;
    if (ctx.mp3Url) URL.revokeObjectURL(ctx.mp3Url);
    ctx.mp3Url = URL.createObjectURL(blob);
    audioEl.src = ctx.mp3Url;
    audioEl.load();
    audioPreview.classList.remove('hidden');
    iconPlay?.classList.remove('hidden');
    iconPause?.classList.add('hidden');
    if (audioSeek) audioSeek.value = '0';
    if (audioTime) audioTime.textContent = '0:00';
    if (audioTotal) audioTotal.textContent = '0:00';
  }

  function formatSecShort(s: number): string {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
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
    const lang = whisperLang?.value || undefined;

    setStage('transcribing');
    setTransProgress(0, 'Subiendo audio…', 'Enviando al servidor', 'Subiendo');

    const abort = new AbortController();
    ctx.transcribeAbort = abort;

    try {
      const { transcribeBlob } = await import('./transcribe');
      const filename =
        ctx.meta?.name
          ? sanitizeName(ctx.meta.name) + '.mp3'
          : 'audio.mp3';

      const result = await transcribeBlob({
        blob: ctx.mp3Blob,
        filename,
        language: lang,
        signal: abort.signal,
        onProgress: (p) => {
          if (p.phase === 'uploading') {
            const pct = p.uploadPct ?? 0;
            setTransProgress(pct, 'Subiendo audio…', `${Math.floor(pct)}% enviado`, 'Subiendo');
          } else if (p.phase === 'transcribing') {
            setTransProgress(null, 'Transcribiendo…', 'Whisper Large v3 Turbo vía Groq', 'En curso');
          }
        },
      });

      const finalText = result.text.trim();
      ctx.transcript = { text: finalText, chunks: result.chunks };
      ctx.transcriptLang = lang ?? 'auto';
      if (transcriptText) transcriptText.value = finalText;
      if (transMeta) {
        const dur = ctx.meta?.durationSec
          ? formatDuration(ctx.meta.durationSec)
          : '—';
        const chunkInfo = result.chunks?.length
          ? ` · ${result.chunks.length} segmentos`
          : '';
        transMeta.textContent = `whisper-large-v3-turbo · ${ctx.transcriptLang} · ${dur}${chunkInfo}`;
      }
      ctx.transcribeAbort = null;
      trackTranscription('whisper-large-v3-turbo', lang, finalText.length);
      setStage('transcript');
      toastSuccess(
        'Transcripción completada',
        `${finalText.length.toLocaleString('es-ES')} caracteres generados.`,
      );
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
      toastSuccess('Copiado', 'Texto copiado al portapapeles.');
    } catch {
      transcriptText.select();
      document.execCommand('copy');
      toastSuccess('Copiado', 'Texto copiado al portapapeles.');
    }
  }

  function baseName(): string {
    const raw = outputName?.value.trim() || ctx.meta?.name || 'transcripcion';
    return sanitizeName(raw) || 'transcripcion';
  }

  function formatTimestampSRT(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function formatTimestampVTT(sec: number): string {
    return formatTimestampSRT(sec).replace(',', '.');
  }

  function buildSRT(): string {
    const chunks = ctx.transcript?.chunks ?? [];
    if (chunks.length === 0) {
      return '1\n00:00:00,000 --> 00:00:10,000\n' + (ctx.transcript?.text ?? '') + '\n';
    }
    return chunks
      .map((c, i) => {
        const start = c.timestamp[0] ?? 0;
        const end = c.timestamp[1] ?? start + 5;
        return `${i + 1}\n${formatTimestampSRT(start)} --> ${formatTimestampSRT(end)}\n${c.text.trim()}\n`;
      })
      .join('\n');
  }

  function buildVTT(): string {
    const chunks = ctx.transcript?.chunks ?? [];
    const header = 'WEBVTT\n\n';
    if (chunks.length === 0) {
      return header + '00:00:00.000 --> 00:00:10.000\n' + (ctx.transcript?.text ?? '') + '\n';
    }
    return (
      header +
      chunks
        .map((c) => {
          const start = c.timestamp[0] ?? 0;
          const end = c.timestamp[1] ?? start + 5;
          return `${formatTimestampVTT(start)} --> ${formatTimestampVTT(end)}\n${c.text.trim()}\n`;
        })
        .join('\n')
    );
  }

  function buildJSON(): string {
    return JSON.stringify(
      {
        model: 'whisper-large-v3-turbo',
        language: ctx.transcriptLang,
        source: ctx.meta?.name,
        durationSec: ctx.meta?.durationSec,
        generatedAt: new Date().toISOString(),
        text: ctx.transcript?.text ?? '',
        chunks: ctx.transcript?.chunks ?? [],
      },
      null,
      2,
    );
  }

  function exportTranscript(format: 'txt' | 'srt' | 'vtt' | 'json') {
    if (!ctx.transcript) return;
    const name = baseName();
    let content = '';
    let mime = 'text/plain;charset=utf-8';
    let ext = 'txt';
    switch (format) {
      case 'srt':
        content = buildSRT();
        mime = 'application/x-subrip;charset=utf-8';
        ext = 'srt';
        break;
      case 'vtt':
        content = buildVTT();
        mime = 'text/vtt;charset=utf-8';
        ext = 'vtt';
        break;
      case 'json':
        content = buildJSON();
        mime = 'application/json;charset=utf-8';
        ext = 'json';
        break;
      default:
        content = ctx.transcript.text;
    }
    const blob = new Blob([content], { type: mime });
    downloadFromBlob(blob, `${name}.${ext}`);
    exportMenu?.classList.add('hidden');
    toastSuccess('Exportado', `${name}.${ext} descargado.`);
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

  btnExportToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu?.classList.toggle('hidden');
  });
  exportOpts.forEach((opt) =>
    opt.addEventListener('click', () => {
      const fmt = opt.getAttribute('data-format') as
        | 'txt'
        | 'srt'
        | 'vtt'
        | 'json';
      if (fmt) exportTranscript(fmt);
    }),
  );
  document.addEventListener('click', (e) => {
    if (!exportMenu || exportMenu.classList.contains('hidden')) return;
    const target = e.target as Node;
    if (
      !exportMenu.contains(target) &&
      !btnExportToggle?.contains(target)
    ) {
      exportMenu.classList.add('hidden');
    }
  });

  // Audio player
  if (audioEl) {
    audioEl.addEventListener('loadedmetadata', () => {
      if (audioTotal) audioTotal.textContent = formatSecShort(audioEl.duration);
    });
    audioEl.addEventListener('timeupdate', () => {
      if (audioTime) audioTime.textContent = formatSecShort(audioEl.currentTime);
      if (audioSeek && audioEl.duration) {
        audioSeek.value = String((audioEl.currentTime / audioEl.duration) * 100);
      }
    });
    audioEl.addEventListener('ended', () => {
      iconPlay?.classList.remove('hidden');
      iconPause?.classList.add('hidden');
    });
    audioEl.addEventListener('play', () => {
      iconPlay?.classList.add('hidden');
      iconPause?.classList.remove('hidden');
    });
    audioEl.addEventListener('pause', () => {
      iconPlay?.classList.remove('hidden');
      iconPause?.classList.add('hidden');
    });
  }
  btnPlay?.addEventListener('click', () => {
    if (!audioEl) return;
    if (audioEl.paused) audioEl.play().catch(() => toastError('No se pudo reproducir'));
    else audioEl.pause();
  });
  audioSeek?.addEventListener('input', () => {
    if (!audioEl || !audioEl.duration) return;
    audioEl.currentTime = (Number(audioSeek.value) / 100) * audioEl.duration;
  });

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
