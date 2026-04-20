export interface User {
  id?: number;
  sub?: number;
  email: string;
  username: string;
  role: 'user' | 'admin';
}

const TOKEN_KEY = 'moesconverter.token';
const USER_KEY = 'moesconverter.user';

export function getApiUrl(): string {
  // Inyectado en build time. Los componentes lo pueden sobreescribir leyendo
  // `data-api-url` del DOM.
  return (import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(
    /\/$/,
    '',
  );
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* noop */
  }
}

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function setUser(user: User): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* noop */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
}

export interface ApiFetchOptions extends RequestInit {
  timeout?: number;
}

export async function apiFetch(
  path: string,
  init: ApiFetchOptions = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers ?? {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const timeout = init.timeout ?? 60_000;
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort);
  }
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        'El servidor tarda demasiado en responder. Inténtalo de nuevo.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}

// Pings /health para despertar el backend (Render free tiene cold start ~50s).
// Sin auth header para evitar respuesta 401 si token está caducado.
let warmupStarted = false;
export function warmupBackend(): void {
  if (warmupStarted) return;
  warmupStarted = true;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 60_000);
  fetch(`${getApiUrl()}/health`, { signal: ctrl.signal }).catch(() => {
    /* silencioso */
  });
}

export async function validateSession(): Promise<User | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await apiFetch('/auth/me');
    if (!res.ok) {
      clearAuth();
      return null;
    }
    const data = (await res.json()) as { user: User };
    setUser(data.user);
    return data.user;
  } catch {
    return null;
  }
}

export function requireAuth(redirect = '/login'): User | null {
  const user = getUser();
  if (!user || !getToken()) {
    window.location.replace(redirect);
    return null;
  }
  return user;
}

export function requireAdmin(redirect = '/'): User | null {
  const user = requireAuth('/login');
  if (!user) return null;
  if (user.role !== 'admin') {
    window.location.replace(redirect);
    return null;
  }
  return user;
}

export async function trackVisit(): Promise<void> {
  try {
    await apiFetch('/track/visit', {
      method: 'POST',
      body: JSON.stringify({ path: window.location.pathname }),
    });
  } catch {
    /* noop */
  }
}

export async function trackTranscription(
  model: string,
  language: string | undefined,
  chars: number,
): Promise<void> {
  try {
    await apiFetch('/track/transcription', {
      method: 'POST',
      body: JSON.stringify({ model, language, chars }),
    });
  } catch {
    /* noop */
  }
}
