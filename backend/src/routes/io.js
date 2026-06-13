// Import / export routes.
import path from 'node:path';
import AdmZip from 'adm-zip';
import multer from 'multer';
import { requireAuth } from '../auth.js';
import { getStorage } from '../storage/index.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function safeFilename(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
}
function stripMdExt(name) { return name.replace(/\.md$/i, ''); }
function noteToMd(note) {
  // Optional frontmatter with title. Body kept as-is.
  const fm = `---\ntitle: ${note.title.replace(/"/g, '\\"')}\n---\n\n`;
  return fm + (note.content || '');
}

export function ioRoutes(app) {
  const storage = getStorage();

  // ----- EXPORT single note -----
  app.get('/api/export/note/:id', requireAuth, (req, res) => {
    const n = storage.getNote(Number(req.params.id));
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const filename = safeFilename(stripMdExt(n.title)) + '.md';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(noteToMd(n));
  });

  // ----- EXPORT all notes as zip -----
  app.get('/api/export/all', requireAuth, (req, res) => {
    const notes = storage.listAllNotes(req.user.id);
    const folders = collectAllFolders(req.user.id);

    const zip = new AdmZip();
    for (const n of notes) {
      const folderPath = folderPathOf(n.folder_id, folders); // returns array of names, root → []
      const fname = safeFilename(stripMdExt(n.title)) + '.md';
      const entryPath = folderPath.length ? folderPath.map(safeFilename).join('/') + '/' + fname : fname;
      zip.addFile(entryPath, Buffer.from(noteToMd(n), 'utf8'));
    }
    const buf = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="jnote-export.zip"');
    res.send(buf);
  });

  // ----- IMPORT -----
  // Accepts: a single .md file, multiple .md files, or a single .zip.
  app.post('/api/import', requireAuth, upload.array('files', 200), (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'no files uploaded' });

    const tree = [];                                  // for zip import → folder tree
    const flatNotes = [];                             // for loose .md files

    for (const f of files) {
      const original = f.originalname;
      const lower = original.toLowerCase();
      if (lower.endsWith('.zip')) {
        const inner = new AdmZip(f.buffer);
        for (const entry of inner.getEntries()) {
          if (entry.isDirectory) continue;
          if (!entry.entryName.toLowerCase().endsWith('.md')) continue;
          const parts = entry.entryName.split('/').filter(Boolean);
          const filename = parts.pop();
          const content = entry.getData().toString('utf8');
          const note = { title: stripMdExt(filename), content: stripFrontmatterTitle(content) };
          insertIntoTree(tree, parts, note);
        }
      } else if (lower.endsWith('.md')) {
        const filename = path.basename(original);
        const content = f.buffer.toString('utf8');
        flatNotes.push({ title: stripMdExt(filename), content: stripFrontmatterTitle(content) });
      } else {
        // ignore unsupported
      }
    }

    // Split out the synthetic __root__ entries — they hold loose .md files
    // at the zip root and should become root-level notes, not a folder.
    const rootEntries = tree.filter(n => n.name === '__root__');
    const folderTree = tree.filter(n => n.name !== '__root__');

    let looseNoteCount = flatNotes.length;
    for (const r of rootEntries) looseNoteCount += r.notes.length;

    if (folderTree.length) storage.importTree(req.user.id, folderTree);
    if (rootEntries.length) {
      // Put zip-root .md files into a folder named "Imported <date>" for
      // visibility — same convention as the flat upload path below.
      const folder = storage.createFolder({ userId: req.user.id, name: `Imported ${new Date().toISOString().slice(0, 10)}` });
      for (const r of rootEntries) {
        for (const n of r.notes) {
          storage.createNote({ userId: req.user.id, folderId: folder.id, title: n.title, content: n.content });
          looseNoteCount++;
        }
      }
    }
    if (flatNotes.length) {
      // Put loose .md files (uploaded directly, not in a zip) into a folder named "Imported <date>".
      const folder = storage.createFolder({ userId: req.user.id, name: `Imported ${new Date().toISOString().slice(0, 10)}` });
      for (const n of flatNotes) {
        storage.createNote({ userId: req.user.id, folderId: folder.id, title: n.title, content: n.content });
        looseNoteCount++;
      }
    }

    res.json({ ok: true, tree: summarize(folderTree), looseNotes: looseNoteCount });
  });
}

function collectAllFolders(userId) {
  // Grab every folder for the user in one go.
  const list = getStorage().listFolders(userId); // only roots
  const all = [...list];
  // BFS
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

// Insert a note into a tree under the given path parts (folder names).
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

// If a note's content starts with a YAML frontmatter, lift `title:` into the
// filename-derived title when they match (case-insensitive). Otherwise leave
// the content untouched. This makes re-export → re-import round-trip cleanly.
function stripFrontmatterTitle(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return content;
  const fm = m[1];
  const titleMatch = fm.match(/^title:\s*(.+)$/m);
  if (!titleMatch) return content;
  return content.slice(m[0].length);
}
