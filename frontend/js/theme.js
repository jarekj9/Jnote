// Theme toggle, persisted in localStorage.
import { state } from './state.js';

const KEY = 'jnote.theme';
export function initTheme() {
  const saved = localStorage.getItem(KEY) || 'light';
  setTheme(saved);
  document.getElementById('themeToggle').addEventListener('click', () => {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
  });
}
export function setTheme(t) {
  state.theme = t;
  document.body.classList.toggle('theme-dark', t === 'dark');
  document.body.classList.toggle('theme-light', t === 'light');
  document.getElementById('themeToggle').innerHTML = t === 'dark' ? '&#9788;' : '&#9728;';
  localStorage.setItem(KEY, t);
}
