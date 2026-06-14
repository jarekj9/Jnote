import { api } from './api.js';
import { state, setState, on } from './state.js';
import { enterApp } from './app.js';

export async function fetchMe() {
  const r = await api.get('/api/auth/me');
  setState({ user: r.user, providers: r.providers || [] });
  return r.user;
}

export async function login(username, password) {
  await api.post('/api/auth/login', { username, password });
  await fetchMe();
  enterApp();
}
export async function register(username, email, password) {
  await api.post('/api/auth/register', { username, email, password });
}
export async function logout() {
  await api.post('/api/auth/logout', {});
  setState({ user: null });
}

export function renderAuth() {
  document.getElementById('auth').hidden = false;
  document.getElementById('topbar').hidden = true;
  document.getElementById('app').hidden = true;

  // Render one "Continue with …" button per enabled OIDC provider.
  const container = document.getElementById('oidcButtons');
  if (container) {
    container.innerHTML = '';
    for (const p of (state.providers || [])) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'oidc-btn';
      btn.textContent = `Continue with ${p.name}`;
      btn.addEventListener('click', () => { location.href = `/api/auth/oidc/${p.id}`; });
      container.appendChild(btn);
    }
  }

  // OIDC error coming back from a failed callback (?oidc_error=…).
  const params = new URLSearchParams(location.search);
  const oauthErr = params.get('oidc_error');
  if (oauthErr) {
    const provider = params.get('provider') || '';
    const providerName = (state.providers || []).find(p => p.id === provider)?.name || provider || 'Identity provider';
    const messages = {
      pending: `Your ${providerName} account is awaiting admin approval.`,
      bad_state: 'Login state mismatch. Try again.',
      token: 'Token exchange with the identity provider failed.',
      profile: 'Profile fetch from the identity provider failed.',
      no_sub: 'Identity provider response was missing the required subject identifier.',
      server: 'Login failed due to a server error.',
    };
    if (oauthErr.startsWith('discovery_')) {
      const id = oauthErr.slice('discovery_'.length);
      setFormMsg('login', `Could not reach the ${id} identity provider (OIDC discovery failed).`, 'error');
    } else {
      setFormMsg('login', messages[oauthErr] || `Login failed (${oauthErr})`, oauthErr === 'pending' ? 'success' : 'error');
    }
    history.replaceState({}, '', '/');
  }
}

export function setFormMsg(form, msg, type = '') {
  const el = document.querySelector(`[data-form="${form}"]`);
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

export function bindAuthForms() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.tab;
      document.getElementById(target + 'Form')?.classList.add('active');
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFormMsg('login', '');
    try {
      await login(fd.get('username'), fd.get('password'));
    } catch (err) {
      setFormMsg('login', err.message, 'error');
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;  // capture before any await — e.currentTarget is nulled out by the browser once the sync handler returns
    const fd = new FormData(form);
    setFormMsg('register', '');
    try {
      const username = fd.get('username');
      await register(username, fd.get('email'), fd.get('password'));
      setFormMsg('register', 'Account created. An admin must approve it before you can log in.', 'success');
      form.reset();
      // Switch to the login tab and pre-fill the username for convenience.
      document.querySelector('.tab[data-tab="login"]').click();
      const loginForm = document.getElementById('loginForm');
      loginForm.querySelector('input[name="username"]').value = username;
      loginForm.querySelector('input[name="password"]').focus();
    } catch (err) {
      setFormMsg('register', err.message, 'error');
    }
  });
}
