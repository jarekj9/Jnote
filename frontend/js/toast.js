// Toast notifications.
let root;
function ensure() { if (!root) root = document.getElementById('toastRoot'); }

export function toast(msg, type = '') {
  ensure();
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3000);
  setTimeout(() => el.remove(), 3500);
}
