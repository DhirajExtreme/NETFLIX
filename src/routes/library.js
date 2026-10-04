const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const {
  addLibrarySource,
  getLibrarySources,
  updateLibrarySource,
  deleteLibrarySource,
} = require('../db/database');
const { VIDEO_EXTENSIONS, scanSource, scanSources, scanAll, getStatus } = require('../services/scanner');
const { testPath } = require('../services/smb');
const { testFtpDirectory, listFtpDirectories, ftpChildUrl, ftpSourceUrl } = require('../services/ftp');
const { localLocations, browseLocal, validateLocalSelection } = require('../services/localLibrary');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SOURCE_TYPES = new Set(['local', 'smb', 'ftp']);

function localOnly(req, res, next) {
  const address = req.socket.remoteAddress || '';
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
      || address === req.socket.localAddress) return next();
  return res.status(403).json({ error: 'Laptop file browsing is available only on this computer' });
}

/**
 * Verify that the given path is reachable.
 * For SMB paths we delegate to smb.testPath(); for local paths we use fs.
 * @param {string} sourcePath
 * @param {string} sourceType 'local' | 'smb' | 'stream'
 * @returns {Promise<boolean>}
 */
async function validateSourcePath(sourcePath, sourceType) {
  if (sourceType === 'smb') {
    const res = await testPath(sourcePath);
    return res.accessible;
  }
  // Local path
  try {
    await fs.promises.access(sourcePath, fs.constants.R_OK);
    const stat = await fs.promises.stat(sourcePath);
    return stat.isDirectory() || (stat.isFile() && VIDEO_EXTENSIONS.includes(path.extname(sourcePath).toLowerCase()));
  } catch {
    return false;
  }
}

function sourceFolderUrl(source, relativePath) {
  if (source.source_type !== 'ftp') throw new Error('Folder browsing requires an FTP source');
  if (typeof relativePath !== 'string') throw new Error('Invalid folder path');
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))) {
    throw new Error('Invalid folder path');
  }
  const root = new URL(source.path);
  const base = decodeURIComponent(root.pathname).replace(/\/?$/, '/');
  return ftpChildUrl(root, base + parts.join('/') + (parts.length ? '/' : ''));
}

// ---------------------------------------------------------------------------
// GET /api/library/sources — list all configured sources
// ---------------------------------------------------------------------------
router.get('/sources', async (req, res, next) => {
  try {
    const sources = await getLibrarySources();
    res.json({ sources: sources.map(source => {
      if (source.source_type !== 'ftp') return source;
      const url = new URL(source.path);
      url.password = '';
      return { ...source, path: url.toString() };
    }) });
  } catch (err) {
    next(err);
  }
});

router.get('/local/locations', localOnly, async (req, res, next) => {
  try { res.json({ locations: await localLocations() }); }
  catch (err) { next(err); }
});

router.get('/local/browse', localOnly, async (req, res) => {
  try { res.json(await browseLocal(req.query.path)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/local/add', localOnly, async (req, res, next) => {
  try {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      return res.status(400).json({ error: 'Choose 1–100 folders or video files' });
    }
    const validated = [];
    for (const item of items) {
      if (!item || !['folder', 'file'].includes(item.kind)) return res.status(400).json({ error: 'Invalid selection' });
      validated.push({ path: await validateLocalSelection(item.path, item.kind), kind: item.kind });
    }
    const existing = new Set(getLibrarySources().map(source => source.path.toLowerCase()));
    const ids = [];
    let skipped = 0;
    for (const item of validated) {
      const key = item.path.toLowerCase();
      if (existing.has(key)) { skipped++; continue; }
      const added = addLibrarySource({
        name: path.basename(item.path) || item.path,
        path: item.path, source_type: 'local', item_kind: item.kind,
      });
      if (!added.changes) return res.status(500).json({ error: 'Could not save local source' });
      ids.push(Number(added.lastInsertRowid));
      existing.add(key);
    }
    const indexing = ids.length > 0 && !getStatus().scanning;
    if (indexing) scanSources(ids).catch(err => console.error('[library] Local indexing error:', err.message));
    res.status(201).json({ ids, skipped, indexing });
  } catch (err) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(err.code) || /^Choose /.test(err.message)) {
      return res.status(400).json({ error: 'Selected path is not accessible' });
    }
    next(err);
  }
});

router.get('/sources/:id/browse', async (req, res, next) => {
  try {
    const source = getLibrarySources().find(item => String(item.id) === req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    const relativePath = req.query.path || '';
    let url;
    try { url = sourceFolderUrl(source, relativePath); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    const names = await listFtpDirectories(url);
    res.json({ path: relativePath, directories: names.map(name => ({
      name, path: [relativePath, name].filter(Boolean).join('/'),
    })) });
  } catch (err) {
    res.status(502).json({ error: `Could not browse FTP folder: ${err.code || err.message}` });
  }
});

router.post('/sources/:id/folders', async (req, res, next) => {
  try {
    const source = getLibrarySources().find(item => String(item.id) === req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    const relativePath = req.body?.path;
    if (!relativePath || typeof relativePath !== 'string') return res.status(400).json({ error: 'Choose a subfolder' });
    let folderUrl;
    try { folderUrl = sourceFolderUrl(source, relativePath); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    const exists = await testFtpDirectory(folderUrl).catch(() => false);
    if (!exists) return res.status(400).json({ error: 'FTP folder is not accessible' });
    if (getLibrarySources().some(item => item.path === folderUrl)) {
      return res.status(409).json({ error: 'Folder is already a source' });
    }
    const name = relativePath.split('/').filter(Boolean).at(-1);
    const created = addLibrarySource({ name, path: folderUrl, source_type: 'ftp' });
    if (!created.changes) return res.status(500).json({ error: 'Could not add folder' });
    updateLibrarySource(source.id, { enabled: 0 });
    res.status(201).json({ id: Number(created.lastInsertRowid), parentDisabled: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/library/sources — add a new library source
// ---------------------------------------------------------------------------
router.post('/sources', async (req, res, next) => {
  try {
    const { name, path: sourcePath, source_type, password } = req.body || {};

    if (!sourcePath || typeof sourcePath !== 'string' || !sourcePath.trim()) {
      return res.status(400).json({ error: '"path" is required' });
    }
    if (!VALID_SOURCE_TYPES.has(source_type)) {
      return res.status(400).json({
        error: `"source_type" must be one of: ${[...VALID_SOURCE_TYPES].join(', ')}`,
      });
    }

    let savedPath = sourcePath.trim();
    if (source_type === 'ftp') {
      try {
        savedPath = ftpSourceUrl(savedPath, password);
        await testFtpDirectory(savedPath);
      } catch (error) {
        const code = Number(error.code);
        const message = error.message === 'Enter a valid ftp:// address' || error.message === 'FTP password must be text' ? error.message
          : code === 530 ? 'FTP login rejected (530). Enter the password for this account.'
          : code === 550 ? 'FTP folder not found or inaccessible (550).'
            : 'Could not connect to the FTP server. Check its address, port, and credentials.';
        return res.status(400).json({ error: message });
      }
    } else {
      const accessible = await validateSourcePath(savedPath, source_type);
      if (!accessible) return res.status(400).json({ error: 'Path is not accessible or does not exist' });
    }

    let sourceName = typeof name === 'string' ? name.trim() : '';
    if (!sourceName && source_type === 'ftp') sourceName = new URL(savedPath).hostname;
    if (!sourceName) return res.status(400).json({ error: '"name" is required' });
    const itemKind = source_type === 'local' && (await fs.promises.stat(savedPath)).isFile() ? 'file' : 'folder';
    const rootFtp = source_type === 'ftp' && new URL(savedPath).pathname === '/';
    const source = await addLibrarySource({
      name: sourceName,
      path: savedPath,
      source_type,
      item_kind: itemKind,
      enabled: rootFtp ? 0 : 1,
    });

    if (!source.changes) return res.status(500).json({ error: 'Could not save source' });
    res.status(201).json({ source: { id: Number(source.lastInsertRowid), enabled: !rootFtp } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/library/sources/:id — update an existing source
// ---------------------------------------------------------------------------
router.put('/sources/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = {};

    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        return res.status(400).json({ error: '"name" must be a non-empty string' });
      }
      updates.name = req.body.name.trim();
    }

    if (req.body.path !== undefined) {
      if (typeof req.body.path !== 'string' || !req.body.path.trim()) {
        return res.status(400).json({ error: '"path" must be a non-empty string' });
      }
      updates.path = req.body.path.trim();
    }

    if (req.body.enabled !== undefined) {
      updates.enabled = Boolean(req.body.enabled);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const source = await updateLibrarySource(id, updates);
    if (!source.changes) {
      return res.status(404).json({ error: 'Source not found' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/library/sources/:id — remove a source
// ---------------------------------------------------------------------------
router.delete('/sources/:id', async (req, res, next) => {
  try {
    await deleteLibrarySource(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/library/scan — trigger a full library scan (runs async)
// ---------------------------------------------------------------------------
router.post('/scan', async (req, res, next) => {
  try {
    // Fire-and-forget: scanAll runs in the background
    scanAll().catch((err) => {
      console.error('[library] Full scan error:', err.message);
    });

    res.json({ status: 'scanning', message: 'Full library scan started' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/library/scan/:sourceId — scan a specific source
// ---------------------------------------------------------------------------
router.post('/scan/:sourceId', async (req, res, next) => {
  try {
    const { sourceId } = req.params;

    // Fire-and-forget
    scanSource(sourceId).catch((err) => {
      console.error(`[library] Scan error for source ${sourceId}:`, err.message);
    });

    res.json({ status: 'scanning', message: `Scan started for source ${sourceId}` });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/library/scan/status — current scan progress
// ---------------------------------------------------------------------------
router.get('/scan/status', async (req, res, next) => {
  try {
    const status = await getStatus();
    res.json({
      scanning: status.scanning || false,
      progress: status.progress || 0,
      total: status.total || 0,
      current: status.current || '',
      errors: status.errors || [],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
