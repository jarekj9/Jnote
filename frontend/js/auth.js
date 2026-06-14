import { api } from './api.js';
import { state, setState, on } from './state.js';
import { enterApp } from './app.js';

export async function fetchMe() {
  const r = await api.get('/api/auth/me');
  setState({ user: r.user, googleEnabled: r.googleEnabled });
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

  document.getElementById('googleLogin').hidden = !state.googleEnabled;
  const params = new URLSearchParams(location.search);
  const oauthErr = params.get('oauth_error');
  if (oauthErr) {
    const messages = {
      pending: 'Your Google account is awaiting admin approval.',
      bad_state: 'OAuth state mismatch. Try again.',
      token: 'Google login failed (token exchange).',
      profile: 'Google login failed (profile).',
      server: 'Google login failed (server error).',
    };
    setFormMsg('login', messages[oauthErr] || 'OAuth error', oauthErr === 'pending' ? 'success' : 'error');
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

  document.getElementById('googleLogin').addEventListener('click', () => {
    location.href = '/api/auth/google';
  });
}
