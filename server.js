/**
 * @fileoverview DS PLIX — Express server entry point.
 *
 * Boots the application by:
 *  1. Loading environment variables from .env
 *  2. Ensuring required data directories exist
 *  3. Initialising the SQLite database
 *  4. Mounting static file serving and API routes
 *  5. Starting the HTTP listener with graceful shutdown support
 *
 * @module server
 */

'use strict';

/* ------------------------------------------------------------------
 * Environment
 * ----------------------------------------------------------------*/

const dotenv = require('dotenv');
dotenv.config();

/* ------------------------------------------------------------------
 * Core imports
 * ----------------------------------------------------------------*/

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const cors    = require('cors');

/* ------------------------------------------------------------------
 * Configuration
 * ----------------------------------------------------------------*/

/** @type {number} HTTP port the server listens on. */
const PORT = parseInt(process.env.PORT, 10) || 3030;

/** @type {string} Root directory for persistent application data. */
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

/** @type {string} Directory for cached thumbnail images. */
const THUMBNAILS_DIR = path.join(DATA_DIR, 'thumbnails');

/** @type {string} Directory for transcoded media cache. */
const TRANSCODE_CACHE_DIR = path.join(DATA_DIR, 'transcode-cache');

/* ------------------------------------------------------------------
 * Data directory bootstrap
 * ----------------------------------------------------------------*/

/**
 * Ensures that all required data directories exist.
 * Creates them recursively if they are missing.
 */
function ensureDataDirectories() {
  const dirs = [DATA_DIR, THUMBNAILS_DIR, TRANSCODE_CACHE_DIR];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[server] Created directory: ${dir}`);
    }
  }
}

ensureDataDirectories();

/* ------------------------------------------------------------------
 * Database initialisation
 * ----------------------------------------------------------------*/

/** @type {Object} Database module with query helpers */
const { closeDb } = require('./src/db/database');

/* ------------------------------------------------------------------
 * Express application
 * ----------------------------------------------------------------*/

const app = express();

/* --- Global middleware ------------------------------------------ */

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// FTP credentials are needed on the server to read files, never in media JSON.
function hideFtpCredentials(value) {
  if (typeof value === 'string' && value.startsWith('ftp://')) {
    try {
      const url = new URL(value);
      url.password = '';
      return url.toString();
    } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(hideFtpCredentials);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hideFtpCredentials(item)]));
  }
  return value;
}
app.use(['/api/media', '/api/history'], (req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = body => sendJson(hideFtpCredentials(body));
  next();
});

/* --- Static files ----------------------------------------------- */

app.use('/vendor/video-js', express.static(path.join(__dirname, 'node_modules', 'video.js', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

/* --- Thumbnail static serving ----------------------------------- */

app.use('/thumbnails', express.static(THUMBNAILS_DIR));

/* --- API routes ------------------------------------------------- */

/**
 * Media routes    – Listing, search, filtering, and TMDB matching.
 * Stream routes   – Video/audio byte-range streaming and HLS transcoding.
 * History routes  – Watch progress tracking.
 * Library routes  – Library source management and scanning.
 * Settings routes – Application configuration.
 */
const mediaRoutes    = require('./src/routes/media');
const streamRoutes   = require('./src/routes/stream');
const historyRoutes  = require('./src/routes/history');
const libraryRoutes  = require('./src/routes/library');
const settingsRoutes = require('./src/routes/settings');
const subtitlesRoutes = require('./src/routes/subtitles');
const privateRoutes = require('./src/routes/private');

app.use('/api/media',    mediaRoutes);
app.use('/api/stream',   streamRoutes);
app.use('/api/history',  historyRoutes);
app.use('/api/library',  libraryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/subtitles', subtitlesRoutes);
app.use('/api/private', privateRoutes);

/* --- SPA fallback ----------------------------------------------- */

/**
 * For any non-API GET request that doesn't match a static file,
 * serve the main index.html so client-side routing works.
 */
app.get('*', (req, res, next) => {
  // Only fall back for non-API, non-thumbnail requests
  if (req.path.startsWith('/api/') || req.path.startsWith('/thumbnails/')) {
    return next();
  }

  const indexPath = path.join(__dirname, 'public', 'index.html');

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  next();
});

/* --- 404 handler ------------------------------------------------ */

/**
 * Catches all unmatched requests and returns a 404 JSON response.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `The requested resource '${req.path}' does not exist.`,
  });
});

/* --- Global error handler --------------------------------------- */

/**
 * Centralised error-handling middleware.
 * Logs the error stack and returns a sanitised JSON response.
 *
 * @param {Error}                             err
 * @param {import('express').Request}         req
 * @param {import('express').Response}        res
 * @param {import('express').NextFunction}    _next
 */
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const redactSecrets = value => String(value).replace(/ftp:\/\/[^/\s]+@/gi, 'ftp://***@');

  console.error(`[server] Error ${status} on ${req.method} ${req.path}:`);
  console.error(redactSecrets(err.stack || err.message || err));

  res.status(status).json({
    error: err.name || 'InternalServerError',
    message:
      process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred.'
        : redactSecrets(err.message || 'An unexpected error occurred.'),
  });
});

/* ------------------------------------------------------------------
 * Start server
 * ----------------------------------------------------------------*/

const server = app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════╗');
  console.log('  ║                                                   ║');
  console.log('  ║   🎬  DS PLIX is running                      ║');
  console.log(`  ║   🌐  http://localhost:${PORT}                      ║`);
  console.log('  ║                                                   ║');
  console.log('  ╚═══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Data directory : ${DATA_DIR}`);
  console.log(`  Thumbnails     : ${THUMBNAILS_DIR}`);
  console.log(`  Transcode cache: ${TRANSCODE_CACHE_DIR}`);
  console.log('');
});

/* ------------------------------------------------------------------
 * Graceful shutdown
 * ----------------------------------------------------------------*/

/**
 * Gracefully shuts down the server by closing open connections
 * and the SQLite database handle.
 *
 * @param {string} signal - The OS signal that triggered shutdown.
 */
function gracefulShutdown(signal) {
  console.log(`\n[server] Received ${signal}. Shutting down gracefully…`);

  server.close(() => {
    console.log('[server] HTTP server closed.');

    try {
      closeDb();
      console.log('[server] Database connection closed.');
    } catch (err) {
      console.error('[server] Error closing database:', err.message);
    }

    console.log('[server] Goodbye. 👋');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long (10 s)
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

/* Handle uncaught errors so the process doesn't silently die */
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

module.exports = app;
