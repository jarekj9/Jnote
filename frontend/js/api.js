// Thin fetch wrapper. Same-origin; cookies carry the JWT automatically.
async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  // 204
  if (res.status === 204) return null;
  const ct = res.headers.get('Content-Type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  get:  (u)      => request('GET', u),
  post: (u, b)   => request('POST', u, b),
  patch:(u, b)   => request('PATCH', u, b),
  del:  (u)      => request('DELETE', u),

  // multipart upload for import
  uploadFiles: async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    const res = await fetch('/api/import', { method: 'POST', credentials: 'same-origin', body: fd });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
};
