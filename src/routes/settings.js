const router = require('express').Router();
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getSetting, setSetting, upsertMedia } = require('../db/database');
const { matchMedia } = require('../services/tmdb');
const { scanAllNetwork } = require('../services/networkScanner');
const { ffmpeg, ffprobe } = require('../services/mediaTools');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** App version – pulled from package.json when available */
let APP_VERSION = '1.0.0';
try {
  const pkg = require('../../package.json');
  APP_VERSION = pkg.version || APP_VERSION;
} catch {
  // package.json may not exist yet during early development
}

/**
 * Mask a sensitive string, showing only the last 4 characters.
 * Returns the original value if it is shorter than 5 characters.
 * @param {string|null} value
 * @returns {string}
 */
function maskApiKey(value) {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= 4) return '****';
  return '*'.repeat(value.length - 4) + value.slice(-4);
}

/**
 * Check if an executable is available on the system PATH.
 * @param {string} bin – binary name (e.g. 'ffmpeg')
 * @returns {Promise<boolean>}
 */
function isInstalled(bin) {
  if (path.isAbsolute(bin)) return fs.promises.access(bin, fs.constants.F_OK).then(() => true, () => false);
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(cmd, [bin], (err) => resolve(!err));
  });
}

/** The settings keys we expose via the API */
const SETTING_KEYS = [
  'tmdb_api_key',
  'opensubtitles_api_key',
  'opensubtitles_username',
  'opensubtitles_password',
  'port',
  'theme',
  'language',
  'transcode_quality',
  'scan_on_startup',
];

// ---------------------------------------------------------------------------
// GET /api/settings — retrieve all settings
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const settings = {};
    for (const key of SETTING_KEYS) {
      settings[key] = await getSetting(key);
    }

    // Mask the TMDB API key before sending to the client
    if (settings.tmdb_api_key) {
      settings.tmdb_api_key = maskApiKey(settings.tmdb_api_key);
    }
    if (settings.opensubtitles_api_key) settings.opensubtitles_api_key = maskApiKey(settings.opensubtitles_api_key);
    if (settings.opensubtitles_password) settings.opensubtitles_password = '********';

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings — update one or more settings
// ---------------------------------------------------------------------------
router.put('/', async (req, res, next) => {
  try {
    const body = req.body || {};

    if (typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const updatedKeys = [];
    for (const key of SETTING_KEYS) {
      if (body[key] !== undefined) {
        await setSetting(key, body[key]);
        updatedKeys.push(key);
      }
    }

    if (updatedKeys.length === 0) {
      return res.status(400).json({
        error: `No valid settings provided. Accepted keys: ${SETTING_KEYS.join(', ')}`,
      });
    }

    res.json({ success: true, updated: updatedKeys });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/settings/stream-link — add a streaming URL as media
// ---------------------------------------------------------------------------
router.post('/stream-link', async (req, res, next) => {
  try {
    const { url, title, media_type } = req.body || {};

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: '"url" is required' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: '"title" is required' });
    }

    // Build a base media object
    const mediaEntry = {
      file_path: url.trim(),
      title: title.trim(),
      source_type: 'stream',
      media_type: media_type || 'movie',
      added_at: new Date().toISOString(),
    };

    // Attempt TMDB match for richer metadata
    try {
      const tmdbData = await matchMedia(title.trim());
      if (tmdbData) {
        mediaEntry.tmdb_id = tmdbData.tmdb_id || null;
        mediaEntry.title = tmdbData.title || mediaEntry.title;
        mediaEntry.overview = tmdbData.overview || null;
        mediaEntry.poster_path = tmdbData.poster_path || null;
        mediaEntry.backdrop_path = tmdbData.backdrop_path || null;
        mediaEntry.genre = tmdbData.genre || null;
        mediaEntry.rating = tmdbData.rating || null;
        mediaEntry.year = tmdbData.year || null;
        mediaEntry.media_type = tmdbData.media_type || mediaEntry.media_type;
      }
    } catch (tmdbErr) {
      // TMDB match is best-effort; continue without metadata
      console.warn('[settings] TMDB match failed for stream link:', tmdbErr.message);
    }

    const media = await upsertMedia(mediaEntry);
    res.status(201).json({ media });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/system-info — system diagnostics
// ---------------------------------------------------------------------------
router.get('/system-info', async (req, res, next) => {
  try {
    const [ffmpegInstalled, ffprobeInstalled] = await Promise.all([
      isInstalled(ffmpeg),
      isInstalled(ffprobe),
    ]);

    res.json({
      ffmpegInstalled,
      ffprobeInstalled,
      version: APP_VERSION,
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage().rss,
      tvUrls: Object.values(os.networkInterfaces()).flat()
        .filter(item => item && item.family === 'IPv4' && !item.internal)
        .map(item => `http://${item.address}:${process.env.PORT || 3030}`),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/network-scan — scan local network for SMB/FTP & drives
// ---------------------------------------------------------------------------
router.get('/network-scan', async (req, res, next) => {
  try {
    const results = await scanAllNetwork();
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/browse — list directories in a given path (SMB/Local/FTP)
// ---------------------------------------------------------------------------
router.get('/browse', async (req, res, next) => {
  try {
    const { path: dirPath, type } = req.query;
    if (!dirPath) {
      return res.status(400).json({ error: 'path is required' });
    }
    const { browseDirectory } = require('../services/networkScanner');
    const results = await browseDirectory(dirPath, type || 'local');
    res.json({ directories: results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
