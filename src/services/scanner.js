/**
 * @module services/scanner
 * @description Media library scanner service. Recursively discovers video files,
 * extracts metadata via ffprobe, matches against TMDB, generates thumbnails
 * with ffmpeg, and persists results to the database.
 */

'use strict';

const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { createHash } = require('crypto');
const { filenameParse } = require('@ctrl/video-filename-parser');
const { Client } = require('basic-ftp');
const { ftpAccessOptions, ftpChildUrl } = require('./ftp');
const { ffmpeg, ffprobe } = require('./mediaTools');
const { acquireFtpProxy } = require('./ftpProxy');

/** @constant {string[]} Supported video file extensions */
const VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.webm', '.mov',
  '.wmv', '.flv', '.ts', '.m4v', '.mpg', '.mpeg', '.m2ts',
  '.3gp', '.ogv', '.vob', '.divx', '.asf', '.rm', '.rmvb'
];

/**
 * Module-level scan state tracking object.
 * @type {{ scanning: boolean, progress: number, total: number, current: string, errors: string[] }}
 */
let scanStatus = { scanning: false, progress: 0, total: 0, current: '', errors: [] };

function parseMediaFilename(fileName) {
  const stem = path.parse(fileName).name;
  let parsed;
  try { parsed = filenameParse(stem); } catch { parsed = { title: stem }; }
  let title = parsed.title || stem;
  title = title.replace(/[_ .-]+(?:Hindi|English|Dual)[_ .-]*(?:Dubbed|Movie)?[_ .-]*$/i, '');
  title = title.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { ...parsed, title: title || stem };
}

/**
 * Recursively scan a directory for video files matching supported extensions.
 *
 * @param {string} dirPath - Absolute path to the directory to scan.
 * @param {string} sourceType - The type of library source (e.g. 'local', 'smb').
 * @returns {Promise<Array<{ filePath: string, fileName: string, sourceType: string }>>}
 *   Array of discovered video file descriptors.
 */
async function scanDirectory(dirPath, sourceType, clientFactory = () => new Client(15000)) {
  /** @type {Array<{ filePath: string, fileName: string, sourceType: string }>} */
  const results = [];

  if (sourceType === 'ftp') {
    const client = clientFactory();
    try {
      const url = new URL(dirPath);
      await client.access(ftpAccessOptions(url));

      async function walkFtp(remoteDir) {
        try {
          const list = await client.list(remoteDir);
          for (const item of list) {
            if (item.name === '.' || item.name === '..') continue;
            const fullPath = remoteDir.endsWith('/') ? `${remoteDir}${item.name}` : `${remoteDir}/${item.name}`;
            
            if (item.isDirectory) {
              await walkFtp(fullPath);
            } else if (item.isFile) {
              const ext = path.extname(item.name).toLowerCase();
              if (VIDEO_EXTENSIONS.includes(ext)) {
                results.push({
                  filePath: ftpChildUrl(url, fullPath),
                  fileName: item.name,
                  fileSize: item.size,
                  sourceType
                });
              }
            }
          }
        } catch (e) {
          if (remoteDir === startPath) throw e;
          scanStatus.errors.push(`FTP folder ${remoteDir}: ${e.message}`);
        }
      }
      
      const startPath = decodeURIComponent(url.pathname) || '/';
      await walkFtp(startPath);
      
    } catch (err) {
      throw new Error(`FTP scan failed: ${err.message}`);
    } finally {
      client.close();
    }
    return results;
  }

  // Local & SMB uses native fs.readdir (Windows UNC support)
  const rootStat = await fs.stat(dirPath);
  if (rootStat.isFile()) {
    if (VIDEO_EXTENSIONS.includes(path.extname(dirPath).toLowerCase())) {
      results.push({ filePath: dirPath, fileName: path.basename(dirPath), fileSize: rootStat.size, sourceType });
    }
    return results;
  }
  async function walk(currentDir) {
    /** @type {import('fs').Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[scanner] Permission error reading directory "${currentDir}": ${err.message}. Skipping.`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.includes(ext)) {
          results.push({
            filePath: fullPath,
            fileName: entry.name,
            sourceType
          });
        }
      }
    }
  }

  await walk(dirPath);
  return results;
}

/**
 * Probe a media file with ffprobe to extract technical metadata.
 *
 * @param {string} filePath - Absolute path to the video file.
 * @returns {Promise<{
 *   duration: number|null,
 *   video_codec: string|null,
 *   audio_codec: string|null,
 *   resolution: string|null,
 *   file_size: number|null,
 *   subtitle_tracks: Array<{ index: number, language: string|null, title: string|null }>,
 *   audio_tracks: Array<{ index: number, language: string|null, title: string|null, codec: string|null }>
 * }|null>} Parsed probe data, or null if ffprobe is unavailable or fails.
 */
async function probeFile(filePath) {
  const proxy = filePath.startsWith('ftp://') ? await acquireFtpProxy(filePath) : null;
  try {
    return await new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      proxy?.url || filePath
    ];

    execFile(ffprobe, args, { timeout: 30000 }, (error, stdout) => {
      if (error) {
        if (error.code === 'ENOENT') {
          console.warn('[scanner] ffprobe not found, skipping media analysis');
        } else {
          console.warn('[scanner] ffprobe could not read a media file');
        }
        return resolve(null);
      }

      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];
        const format = data.format || {};

        const videoStream = streams.find((s) => s.codec_type === 'video');
        const audioStream = streams.find((s) => s.codec_type === 'audio');

        const subtitleTracks = streams
          .filter((s) => s.codec_type === 'subtitle')
          .map((s) => ({
            index: s.index,
            language: (s.tags && s.tags.language) || null,
            title: (s.tags && s.tags.title) || null
          }));

        const audioTracks = streams
          .filter((s) => s.codec_type === 'audio')
          .map((s) => ({
            index: s.index,
            language: (s.tags && s.tags.language) || null,
            title: (s.tags && s.tags.title) || null,
            codec: s.codec_name || null
          }));

        resolve({
          duration: format.duration ? parseFloat(format.duration) : null,
          video_codec: videoStream ? videoStream.codec_name : null,
          audio_codec: audioStream ? audioStream.codec_name : null,
          resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
          file_size: format.size ? parseInt(format.size, 10) : null,
          subtitle_tracks: subtitleTracks,
          audio_tracks: audioTracks
        });
      } catch (parseErr) {
        console.warn(`[scanner] Failed to parse ffprobe output: ${parseErr.message}`);
        resolve(null);
      }
    });
    });
  } finally {
    proxy?.release();
  }
}

/**
 * Match a parsed filename against TMDB for rich metadata.
 *
 * @param {{ title: string, year?: number, isTv?: boolean }} parsedFilename
 *   Output from @ctrl/video-filename-parser's filenameParse.
 * @returns {Promise<object|null>} TMDB match result, or null on error.
 */
async function matchWithTMDB(parsedFilename) {
  try {
    const tmdb = require('./tmdb').getInstance();
    const title = parsedFilename.title || '';
    const year = parsedFilename.year || undefined;
    const isTVShow = Boolean(parsedFilename.isTv);
    if (!title || (!/[a-z]/i.test(title) && !parsedFilename.year) || /^(?:IMG|VID|PXL|MOV|MVI|DSC|Story|Screenshot|Screen.?Recording|WhatsApp)[_ .-]/i.test(title) || /^\d{4}-\d{2}_\d{10,}/.test(title)) return null;
    const result = await tmdb.matchMedia(title, year, isTVShow);
    return result;
  } catch (err) {
    console.warn(`[scanner] TMDB match failed for "${parsedFilename.title}": ${err.message}`);
    return null;
  }
}

/**
 * Generate a JPEG thumbnail for a video file using ffmpeg.
 *
 * Seeks to 10% of the video duration (determined via {@link probeFile}, falling
 * back to 60 s) and extracts a single frame scaled to 480 px wide.
 *
 * @param {string} filePath   - Absolute path to the source video.
 * @param {string} outputPath - Absolute path for the output thumbnail image.
 * @returns {Promise<string|null>} The outputPath on success, or null if ffmpeg
 *   is unavailable or the operation fails.
 */
async function generateThumbnail(filePath, outputPath) {
  let duration = 60;
  try {
    const probeData = await probeFile(filePath);
    if (probeData && probeData.duration && probeData.duration > 0) {
      duration = probeData.duration;
    }
  } catch (_) {
    /* keep default duration */
  }

  const seekTime = Math.floor(duration * 0.1);

  return new Promise((resolve) => {
    const args = [
      '-ss', String(seekTime),
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'scale=480:-1',
      '-y',
      outputPath
    ];

    execFile(ffmpeg, args, { timeout: 30000 }, (error) => {
      if (error) {
        if (error.code === 'ENOENT') {
          console.warn('[scanner] ffmpeg not found, skipping thumbnail generation');
        } else {
          console.warn('[scanner] ffmpeg could not generate a thumbnail');
        }
        return resolve(null);
      }
      resolve(outputPath);
    });
  });
}

/**
 * Full processing pipeline for a single media file.
 *
 * 1. Parse the filename for title / year / season / episode info.
 * 2. Probe technical metadata with ffprobe.
 * 3. Query TMDB for rich metadata.
 * 4. Generate a thumbnail frame.
 * 5. Upsert the combined record into the database.
 *
 * Each step is wrapped so that a failure in one does not abort the pipeline.
 *
 * @param {string} filePath    - Absolute path to the video file.
 * @param {string} sourceType  - Library source type (e.g. 'local', 'smb').
 * @returns {Promise<object|null>} The upserted media row, or null on critical failure.
 */
async function processFile(filePath, sourceType, fileSize = null) {
  try {
    const db = require('../db/database');
    const locked = db.getDb().prepare('SELECT metadata_locked FROM media WHERE file_path = ?').get(filePath)?.metadata_locked === 1;
    const fileName = sourceType === 'ftp'
      ? path.posix.basename(decodeURIComponent(new URL(filePath).pathname))
      : path.basename(filePath);

    /* Step 1 – Parse filename */
    const parsed = parseMediaFilename(fileName);
    const episode = fileName.match(/^(.*?)\bS\d{1,2}E\d{1,2}\b/i);
    if (episode) {
      parsed.title = episode[1].replace(/[._-]+/g, ' ').trim();
      parsed.isTv = true;
    }

    /* Step 2 – Probe media info */
    let probeData = null;
    try {
      if (sourceType !== 'ftp') probeData = await probeFile(filePath);
    } catch (err) {
      console.warn(`[scanner] Probe failed for "${fileName}": ${err.message}`);
    }

    /* Step 3 – TMDB lookup */
    let tmdbData = null;
    try {
      const mediaPath = sourceType === 'ftp' ? decodeURIComponent(new URL(filePath).pathname) : filePath;
      if (!locked && !/(?:^|[/\\])(?:DCIM|Camera|WhatsApp Video)(?:[/\\]|$)/i.test(mediaPath)
          && (sourceType !== 'ftp' || parsed.year || (fileSize || 0) >= 100_000_000)) {
        tmdbData = await matchWithTMDB(parsed);
      }
    } catch (err) {
      console.warn(`[scanner] TMDB lookup failed for "${fileName}": ${err.message}`);
    }

    /* Step 4 – Thumbnail generation */
    let thumbnailPath = null;
    try {
      const thumbDir = path.resolve(process.env.DATA_DIR || './data', 'thumbnails');
      await fs.mkdir(thumbDir, { recursive: true });
      const thumbFile = `${createHash('sha256').update(filePath).digest('hex')}.jpg`;
      const outputPath = path.join(thumbDir, thumbFile);
      if (sourceType !== 'ftp' && !tmdbData?.poster_path) thumbnailPath = await generateThumbnail(filePath, outputPath);
    } catch (err) {
      console.warn(`[scanner] Thumbnail generation failed for "${fileName}": ${err.message}`);
    }

    /* Step 5 – Persist to database */
    const mediaRecord = {
      title: (tmdbData && tmdbData.title) || parsed.title || path.parse(fileName).name,
      file_path: filePath,
      original_filename: fileName,
      source_type: sourceType,
      media_type: (tmdbData && tmdbData.media_type) || (parsed.isTv ? 'tv' : 'movie'),
      year: (tmdbData && tmdbData.year) || parsed.year || null,
      tmdb_id: (tmdbData && tmdbData.tmdb_id) || null,
      overview: (tmdbData && tmdbData.overview) || null,
      poster_path: (tmdbData && tmdbData.poster_path) || null,
      backdrop_path: (tmdbData && tmdbData.backdrop_path) || null,
      genre: (tmdbData && tmdbData.genre) || null,
      rating: (tmdbData && tmdbData.rating) || null,
      runtime: (tmdbData && tmdbData.runtime) || null,
      duration: probeData ? probeData.duration : null,
      video_codec: probeData ? probeData.video_codec : null,
      audio_codec: probeData ? probeData.audio_codec : null,
      resolution: probeData ? probeData.resolution : null,
      file_size: probeData?.file_size || fileSize,
      subtitle_tracks: probeData ? JSON.stringify(probeData.subtitle_tracks) : null,
      audio_tracks: probeData ? JSON.stringify(probeData.audio_tracks) : null,
      local_thumbnail: thumbnailPath,
    };

    db.upsertMedia(mediaRecord);
    return mediaRecord;
  } catch (err) {
    console.error(`[scanner] processFile critical error: ${err.message}`);
    return null;
  }
}

/**
 * Scan a single library source by its database ID.
 *
 * Retrieves the source record, walks its directory, processes every discovered
 * video file, updates the source's `last_scanned` timestamp, and keeps the
 * module-level {@link scanStatus} in sync throughout.
 *
 * @param {number|string} sourceId - The library source ID to scan.
 * @returns {Promise<void>}
 */
async function scanSource(sourceId) {
  if (scanStatus.scanning) return;
  const db = require('../db/database');
  scanStatus = { scanning: true, progress: 0, total: 0, current: '', errors: [] };
  try {
    const source = db.getLibrarySources().find(s => String(s.id) === String(sourceId));
    if (!source) throw new Error(`Library source ${sourceId} not found`);
    const files = await discoverAndIndex(source);
    if (!files) return;
    await enrichFiles(files);
    if (files.length) db.updateLibrarySource(source.id, { last_scanned: new Date().toISOString() });
  } catch (err) {
    scanStatus.errors.push(err.message);
  } finally {
    scanStatus.scanning = false;
    scanStatus.current = '';
  }
}

async function scanSources(sourceIds) {
  if (scanStatus.scanning) return false;
  const db = require('../db/database');
  const wanted = new Set(sourceIds.map(String));
  scanStatus = { scanning: true, progress: 0, total: 0, current: '', errors: [] };
  try {
    const sources = db.getLibrarySources().filter(source => wanted.has(String(source.id)) && source.enabled);
    const allFiles = [];
    for (const source of sources) {
      const files = await discoverAndIndex(source);
      if (files) {
        allFiles.push(...files);
        db.updateLibrarySource(source.id, { last_scanned: new Date().toISOString() });
      }
    }
    await enrichFiles(allFiles);
    return true;
  } catch (err) {
    scanStatus.errors.push(err.message);
    return false;
  } finally {
    scanStatus.scanning = false;
    scanStatus.current = '';
  }
}

async function discoverAndIndex(source) {
  const db = require('../db/database');
  console.log(`[scanner] Scanning source "${source.name}"`);
  let files;
  try {
    files = await scanDirectory(source.path, source.source_type || 'local');
  } catch (err) {
    scanStatus.errors.push(`${source.name}: ${err.message}`);
    return null;
  }
  for (const file of files) {
    const parsed = parseMediaFilename(file.fileName);
    db.insertDiscoveredMedia({
      title: parsed.title || path.parse(file.fileName).name,
      original_filename: file.fileName,
      file_path: file.filePath,
      source_type: file.sourceType,
      media_type: /\bS\d{1,2}E\d{1,2}\b/i.test(file.fileName) ? 'tv' : 'movie',
      file_size: file.fileSize ?? null,
    });
  }
  scanStatus.total += files.length;
  console.log(`[scanner] Indexed ${files.length} file(s) from "${source.name}"`);
  return files;
}

async function enrichFiles(files) {
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      scanStatus.current = file.fileName;
      const result = await processFile(file.filePath, file.sourceType, file.fileSize);
      if (!result) scanStatus.errors.push(`Could not process ${file.fileName}`);
      scanStatus.progress += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
}

function isWithinSource(row, source) {
  if (source.source_type !== row.source_type) return false;
  if (source.source_type === 'ftp') {
    const root = source.path.endsWith('/') ? source.path : source.path + '/';
    return row.file_path.startsWith(root);
  }
  if (source.item_kind === 'file') {
    return row.file_path.replace(/[/\\]+/g, '\\').toLowerCase()
      === source.path.replace(/[/\\]+/g, '\\').toLowerCase();
  }
  const root = source.path.replace(/[/\\]+/g, '\\').replace(/\\?$/, '\\').toLowerCase();
  return row.file_path.replace(/[/\\]+/g, '\\').toLowerCase().startsWith(root);
}

function pruneOutsideSources(sources) {
  if (!sources.length) return 0;
  const db = require('../db/database').getDb();
  const rows = db.prepare("SELECT id, file_path, source_type FROM media WHERE source_type != 'stream'").all();
  const remove = db.prepare('DELETE FROM media WHERE id = ?');
  const prune = db.transaction(() => {
    let deleted = 0;
    for (const row of rows) {
      const covered = sources.some(source => isWithinSource(row, source));
      if (!covered) deleted += remove.run(row.id).changes;
    }
    return deleted;
  });
  return prune();
}

/**
 * Scan all enabled library sources.
 *
 * Sets the module-level {@link scanStatus} to active, iterates over every
 * enabled source, processes all discovered files, and resets the status when
 * finished.
 *
 * @returns {Promise<void>}
 */
async function scanAll() {
  if (scanStatus.scanning) {
    console.warn('[scanner] Scan already in progress, skipping');
    return;
  }

  const db = require('../db/database');

  /* Reset scan status */
  scanStatus = { scanning: true, progress: 0, total: 0, current: '', errors: [] };

  try {
    const sources = await db.getLibrarySources();
    const enabledSources = sources.filter((s) => s.enabled !== false && s.enabled !== 0);

    if (enabledSources.length === 0) {
      console.log('[scanner] No enabled library sources found');
      return;
    }

    console.log(`[scanner] Starting full scan of ${enabledSources.length} source(s)`);

    const allFiles = [];
    const scannedSources = [];
    for (const source of enabledSources) {
      const files = await discoverAndIndex(source);
      if (files) {
        allFiles.push(...files);
        scannedSources.push(source);
      }
    }
    await enrichFiles(allFiles);
    const removed = pruneOutsideSources(enabledSources);
    if (removed) console.log(`[scanner] Removed ${removed} file(s) outside enabled sources`);
    for (const source of scannedSources) {
      db.updateLibrarySource(source.id, { last_scanned: new Date().toISOString() });
    }

    console.log(
      `[scanner] Full scan complete. Processed ${scanStatus.progress}/${scanStatus.total} files` +
      (scanStatus.errors.length > 0 ? ` with ${scanStatus.errors.length} error(s)` : '')
    );
  } catch (err) {
    console.error(`[scanner] scanAll critical error: ${err.message}`);
    scanStatus.errors.push(`Critical: ${err.message}`);
  } finally {
    scanStatus.scanning = false;
    scanStatus.current = '';
  }
}

async function enrichUnmatched() {
  if (scanStatus.scanning) return;
  const db = require('../db/database');
  const rows = db.getDb().prepare(`SELECT file_path AS filePath,
    original_filename AS fileName, source_type AS sourceType,
    file_size AS fileSize FROM media WHERE tmdb_id IS NULL`).all();
  scanStatus = { scanning: true, progress: 0, total: rows.length, current: '', errors: [] };
  try {
    await enrichFiles(rows);
  } finally {
    scanStatus.scanning = false;
    scanStatus.current = '';
  }
}

/**
 * Return the current scan status.
 *
 * @returns {{ scanning: boolean, progress: number, total: number, current: string, errors: string[] }}
 */
function getStatus() {
  return scanStatus;
}

module.exports = {
  VIDEO_EXTENSIONS,
  parseMediaFilename,
  isWithinSource,
  scanDirectory,
  probeFile,
  matchWithTMDB,
  generateThumbnail,
  processFile,
  scanSource,
  scanSources,
  scanAll,
  enrichUnmatched,
  getStatus
};
