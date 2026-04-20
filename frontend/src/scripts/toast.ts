type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastOpts {
  title?: string;
  description?: string;
  duration?: number;
  kind?: ToastKind;
}

const ICONS: Record<ToastKind, string> = {
  success:
    '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error:
    '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  info: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  warning:
    '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

const COLORS: Record<ToastKind, string> = {
  success:
    'bg-emerald-500/15 text-emerald-100 border-emerald-400/40 shadow-[0_8px_30px_-6px_rgba(16,185,129,0.35)]',
  error:
    'bg-rose-500/15 text-rose-100 border-rose-400/40 shadow-[0_8px_30px_-6px_rgba(244,63,94,0.35)]',
  info: 'bg-sky-500/15 text-sky-100 border-sky-400/40 shadow-[0_8px_30px_-6px_rgba(56,189,248,0.35)]',
  warning:
    'bg-amber-500/15 text-amber-100 border-amber-400/40 shadow-[0_8px_30px_-6px_rgba(245,158,11,0.35)]',
};

function ensureRoot(): HTMLElement | null {
  return document.getElementById('toast-root');
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toast(opts: ToastOpts | string): void {
  const data: ToastOpts =
    typeof opts === 'string' ? { title: opts } : opts;
  const kind = data.kind ?? 'info';
  const duration = data.duration ?? 4000;
  const root = ensureRoot();
  if (!root) return;

  const el = document.createElement('div');
  el.className = `pointer-events-auto flex items-start gap-2.5 w-full sm:w-auto sm:min-w-[260px] sm:max-w-sm
                  px-3.5 py-3 rounded-xl border backdrop-blur-md
                  text-sm font-medium
                  ${COLORS[kind]}
                  transform translate-y-[-20px] sm:translate-y-0 sm:translate-x-4 opacity-0 transition-all duration-300`;
  el.innerHTML = `
    <span class="shrink-0 mt-0.5">${ICONS[kind]}</span>
    <div class="flex-1 min-w-0">
      ${data.title ? `<p class="text-white font-semibold leading-tight">${escape(data.title)}</p>` : ''}
      ${data.description ? `<p class="text-xs opacity-80 mt-0.5 leading-snug">${escape(data.description)}</p>` : ''}
    </div>
    <button type="button" aria-label="Cerrar"
            class="shrink-0 w-5 h-5 rounded-md grid place-items-center opacity-60 hover:opacity-100 transition-opacity">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  root.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.remove('translate-y-[-20px]', 'sm:translate-x-4', 'opacity-0');
  });

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.add('opacity-0', 'sm:translate-x-4', 'translate-y-[-20px]');
    setTimeout(() => el.remove(), 300);
  };

  el.querySelector('button')?.addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
}

export const toastSuccess = (title: string, description?: string) =>
  toast({ kind: 'success', title, description });
export const toastError = (title: string, description?: string) =>
  toast({ kind: 'error', title, description });
export const toastInfo = (title: string, description?: string) =>
  toast({ kind: 'info', title, description });
export const toastWarning = (title: string, description?: string) =>
  toast({ kind: 'warning', title, description });
