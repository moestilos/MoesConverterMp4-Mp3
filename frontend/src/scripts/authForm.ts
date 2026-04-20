import { apiFetch, setToken, setUser, warmupBackend } from './auth';

type Mode = 'login' | 'register';

export function initAuthForm(mode: Mode): void {
  const form = document.getElementById('auth-form') as HTMLFormElement | null;
  if (!form) return;

  // Despierta backend en segundo plano al cargar la página (Render free duerme).
  warmupBackend();

  const errorBox = document.getElementById('form-error');
  const errorMsg = document.getElementById('form-error-msg');
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement | null;
  const submitLabel = document.getElementById('submit-label');
  const submitSpinner = document.getElementById('submit-spinner');
  const toggleBtn = document.getElementById('toggle-pw');
  const passwordInput = document.getElementById('password') as HTMLInputElement | null;
  const eyeOn = document.getElementById('eye-on');
  const eyeOff = document.getElementById('eye-off');
  const firstInput = document.getElementById(
    mode === 'register' ? 'email' : 'identifier',
  ) as HTMLInputElement | null;

  // Autofocus first field (but avoid on iOS — causes keyboard pop jump)
  if (firstInput && !/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    setTimeout(() => firstInput.focus(), 50);
  }

  toggleBtn?.addEventListener('click', () => {
    if (!passwordInput) return;
    const isPw = passwordInput.type === 'password';
    passwordInput.type = isPw ? 'text' : 'password';
    eyeOn?.classList.toggle('hidden', isPw);
    eyeOff?.classList.toggle('hidden', !isPw);
    passwordInput.focus();
  });

  function showError(msg: string) {
    if (errorMsg) errorMsg.textContent = msg;
    errorBox?.classList.remove('hidden');
    errorBox?.classList.add('flex');
  }

  function clearError() {
    errorBox?.classList.add('hidden');
    errorBox?.classList.remove('flex');
  }

  function setLoading(loading: boolean) {
    if (submitBtn) submitBtn.disabled = loading;
    submitLabel?.classList.toggle('hidden', loading);
    submitLabel?.classList.toggle('flex', !loading);
    submitSpinner?.classList.toggle('hidden', !loading);
    submitSpinner?.classList.toggle('flex', loading);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const fd = new FormData(form);
    const password = String(fd.get('password') ?? '');

    if (mode === 'register' && password.length < 6) {
      showError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setLoading(true);

    // Si tarda >3s, avisa de cold start.
    const slowTimer = setTimeout(() => {
      const lbl = document.querySelector('#submit-spinner span');
      if (lbl) lbl.textContent = 'Despertando servidor…';
    }, 3000);

    try {
      let res: Response;
      if (mode === 'login') {
        res = await apiFetch('/auth/login', {
          method: 'POST',
          timeout: 60_000,
          body: JSON.stringify({
            identifier: String(fd.get('identifier') ?? '').trim(),
            password,
          }),
        });
      } else {
        res = await apiFetch('/auth/register', {
          method: 'POST',
          timeout: 60_000,
          body: JSON.stringify({
            email: String(fd.get('email') ?? '').trim(),
            username: String(fd.get('identifier') ?? '').trim(),
            password,
          }),
        });
      }
      clearTimeout(slowTimer);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ??
            (mode === 'login'
              ? 'Credenciales inválidas.'
              : 'No se pudo crear la cuenta.'),
        );
      }

      setToken(data.token);
      setUser(data.user);
      const next =
        mode === 'login'
          ? new URLSearchParams(window.location.search).get('next') ?? '/'
          : '/';
      window.location.href = next;
    } catch (err) {
      clearTimeout(slowTimer);
      setLoading(false);
      const msg = err instanceof Error ? err.message : 'Error desconocido.';
      showError(
        msg === 'Failed to fetch'
          ? 'No se pudo conectar con el servidor. Comprueba tu conexión.'
          : msg,
      );
    }
  });
}
