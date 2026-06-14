// Import / export routes.
import AdmZip from 'adm-zip';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth.js';
import { getStorage } from '../storage/index.js';
import { config } from '../config.js';
import {
  validateFolderName,
  validateZipPath,
} from '../validation.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },  // 20MB per file, 5 files
});

const importLimiter = (() => {
  if (!config.rateLimit.import.max) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: config.rateLimit.import.windowMs,
    max: config.rateLimit.import.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many import requests' },
  });
})();

// Restrict the filename used in the download Content-Disposition to a safe
// ASCII subset. Strips control chars, newlines, quotes, and path separators
// to prevent header injection.
function safeFilename(s) {
  return String(s).replace(/[\x00-\x1F\x7F\\/:*?"<>|\r\n]/g, '_').trim() || 'untitled';
}
function stripMdExt(name) { return name.replace(/\.md$/i, ''); }
function noteToMd(note) {
  const fm = `---\ntitle: ${String(note.title).replace(/"/g, '\\"')}\n---\n\n`;
  return fm + (note.content || '');
}

export function ioRoutes(app) {
  const storage = getStorage();

  // ----- EXPORT single note -----
  app.get('/api/export/note/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    const n = storage.getNote(id);
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const filename = safeFilename(stripMdExt(n.title)) + '.md';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(noteToMd(n));
  });

  // ----- EXPORT all notes as zip -----
  app.get('/api/export/all', requireAuth, (req, res) => {
    const notes = storage.listAllNotes(req.user.id);
    const folders = collectAllFolders(req.user.id);

    const zip = new AdmZip();
    for (const n of notes) {
      const folderPath = folderPathOf(n.folder_id, folders);
      const fname = safeFilename(stripMdExt(n.title)) + '.md';
      const entryPath = folderPath.length
        ? folderPath.map(safeFilename).join('/') + '/' + fname
        : fname;
      // Defensive: never write a zip entry with traversal/absolute segments.
      if (validateZipPath(entryPath)) continue;
      zip.addFile(entryPath, Buffer.from(noteToMd(n), 'utf8'));
    }
    const buf = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="jnote-export.zip"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  });

  // ----- IMPORT -----
  app.post('/api/import', requireAuth, importLimiter, upload.array('files', 5), (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'no files uploaded' });

    const tree = [];
    const flatNotes = [];
    let skipped = 0;

    for (const f of files) {
      const original = String(f.originalname || '');
      const lower = original.toLowerCase();
      try {
        if (lower.endsWith('.zip')) {
          const inner = new AdmZip(f.buffer);
          for (const entry of inner.getEntries()) {
            if (entry.isDirectory) continue;
            if (!entry.entryName.toLowerCase().endsWith('.md')) continue;
            const pathErr = validateZipPath(entry.entryName);
            if (pathErr) { skipped++; continue; }
            const parts = entry.entryName.split(/[\\/]+/).filter(Boolean);
            const filename = parts.pop();
            const nameErr = validateFolderName(filename);  // also applies to filenames
            if (nameErr) { skipped++; continue; }
            const note = { title: stripMdExt(filename), content: stripFrontmatterTitle(entry.getData().toString('utf8')) };
            insertIntoTree(tree, parts, note);
          }
        } else if (lower.endsWith('.md')) {
          const base = original.replace(/^.*[\\/]/, '');  // basename
          const nameErr = validateFolderName(base);
          if (nameErr) { skipped++; continue; }
          flatNotes.push({ title: stripMdExt(base), content: stripFrontmatterTitle(f.buffer.toString('utf8')) });
        }
        // else: unsupported file type, silently ignored
      } catch (e) {
        skipped++;
      }
    }

    const rootEntries = tree.filter(n => n.name === '__root__');
    const folderTree = tree.filter(n => n.name !== '__root__');
    let looseNoteCount = flatNotes.length;
    for (const r of rootEntries) looseNoteCount += r.notes.length;

    if (folderTree.length) storage.importTree(req.user.id, folderTree);
    if (rootEntries.length) {
      const folder = storage.createFolder({ userId: req.user.id, name: `Imported ${new Date().toISOString().slice(0, 10)}` });
      for (const r of rootEntries) {
        for (const n of r.notes) {
          storage.createNote({ userId: req.user.id, folderId: folder.id, title: n.title, content: n.content });
          looseNoteCount++;
        }
      }
    }
    if (flatNotes.length) {
      const folder = storage.createFolder({ userId: req.user.id, name: `Imported ${new Date().toISOString().slice(0, 10)}` });
      for (const n of flatNotes) {
        storage.createNote({ userId: req.user.id, folderId: folder.id, title: n.title, content: n.content });
        looseNoteCount++;
      }
    }

    res.json({ ok: true, tree: summarize(folderTree), looseNotes: looseNoteCount, skipped });
  });
}

function collectAllFolders(userId) {
  const list = getStorage().listFolders(userId);
  const all = [...list];
  for (let i = 0; i < all.length; i++) {
    const children = getStorage().listFolders(userId, { parentId: all[i].id });
    all.push(...children);
  }
  return all;
}
function folderPathOf(folderId, allFolders) {
  const out = [];
  let cur = allFolders.find(f => f.id === folderId);
  while (cur) {
    out.unshift(cur.name);
    cur = cur.parent_id ? allFolders.find(f => f.id === cur.parent_id) : null;
  }
  return out;
}

function insertIntoTree(tree, parts, note) {
  if (!parts.length) {
    tree.push({ name: '__root__', notes: [note], folders: [] });
    return;
  }
  const [head, ...rest] = parts;
  let node = tree.find(n => n.name === head);
  if (!node) { node = { name: head, notes: [], folders: [] }; tree.push(node); }
  if (!rest.length) node.notes.push(note);
  else insertIntoTree(node.folders, rest, note);
}

function summarize(tree) {
  let folders = 0, notes = 0;
  const walk = (arr) => {
    for (const n of arr) {
      if (n.name !== '__root__') folders++;
      notes += n.notes?.length || 0;
      if (n.folders) walk(n.folders);
    }
  };
  walk(tree);
  return { folders, notes };
}

// Round-trip helper: when an exported note is re-imported, drop the YAML
// frontmatter so the title doesn't appear twice in the rendered preview.
function stripFrontmatterTitle(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return content;
  const fm = m[1];
  const titleMatch = fm.match(/^title:\s*(.+)$/m);
  if (!titleMatch) return content;
  return content.slice(m[0].length);
}
