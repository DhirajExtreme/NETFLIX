'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * @file Database module for DS PLIX media server.
 * @description Initializes and manages a SQLite database using better-sqlite3.
 * Provides helper functions for media, watch history, library sources, and settings.
 * Enables WAL mode and foreign keys on init. Uses prepared statements for performance.
 */

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || './data';

// Ensure the data directory exists before opening the database file.
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'ds-plix.db');

/** @type {import('better-sqlite3').Database} */
let db;

try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error(`[database] Failed to open database at ${DB_PATH}:`, err.message);
  process.exit(1);
}

// Enable WAL mode for better concurrent read performance.
db.pragma('journal_mode = WAL');

// Enable foreign key constraint enforcement.
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    original_filename TEXT,
    file_path TEXT NOT NULL UNIQUE,
    source_type TEXT DEFAULT 'local',
    media_type TEXT DEFAULT 'movie',
    tmdb_id INTEGER,
    metadata_locked INTEGER DEFAULT 0,
    year INTEGER,
    genre TEXT,
    overview TEXT,
    rating REAL,
    runtime INTEGER,
    poster_path TEXT,
    backdrop_path TEXT,
    local_thumbnail TEXT,
    video_codec TEXT,
    audio_codec TEXT,
    resolution TEXT,
    file_size INTEGER,
    duration REAL,
    subtitle_tracks TEXT,
    audio_tracks TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL UNIQUE,
    progress REAL DEFAULT 0,
    duration REAL DEFAULT 0,
    completed INTEGER DEFAULT 0,
    last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
    watch_count INTEGER DEFAULT 1,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS library_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    source_type TEXT DEFAULT 'local',
    item_kind TEXT DEFAULT 'folder',
    enabled INTEGER DEFAULT 1,
    last_scanned DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS external_subtitles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    language TEXT NOT NULL,
    source TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
  );
`);

// Existing libraries predate user-controlled TMDB matches.
if (!db.pragma('table_info(media)').some(column => column.name === 'metadata_locked')) {
  db.exec('ALTER TABLE media ADD COLUMN metadata_locked INTEGER DEFAULT 0');
}
if (!db.pragma('table_info(library_sources)').some(column => column.name === 'item_kind')) {
  db.exec("ALTER TABLE library_sources ADD COLUMN item_kind TEXT DEFAULT 'folder'");
}

// ---------------------------------------------------------------------------
// Prepared statements (created lazily via getters for resilience)
// ---------------------------------------------------------------------------

/** @type {Map<string, import('better-sqlite3').Statement>} */
const _stmtCache = new Map();

/**
 * Returns a cached prepared statement, creating it on first access.
 *
 * @param {string} key  - Unique cache key.
 * @param {string} sql  - SQL to prepare.
 * @returns {import('better-sqlite3').Statement}
 */
function stmt(key, sql) {
  if (!_stmtCache.has(key)) {
    _stmtCache.set(key, db.prepare(sql));
  }
  return _stmtCache.get(key);
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Allowed columns for ORDER BY to prevent SQL injection in dynamic sort clauses.
 * @type {Set<string>}
 */
const ALLOWED_SORT_COLUMNS = new Set([
  'added_at', 'updated_at', 'title', 'year', 'rating', 'runtime', 'file_size', 'duration',
]);

/**
 * Sanitise a sort column name – falls back to 'added_at' if the value is not
 * in the allow-list.
 *
 * @param {string} [col]
 * @returns {string}
 */
function safeSortColumn(col) {
  if (col && ALLOWED_SORT_COLUMNS.has(col)) return col;
  return 'added_at';
}

/**
 * Sanitise sort order – only 'ASC' or 'DESC'.
 *
 * @param {string} [order]
 * @returns {'ASC'|'DESC'}
 */
function safeSortOrder(order) {
  return order && order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

// ---------------------------------------------------------------------------
// Exported helper functions
// ---------------------------------------------------------------------------

/**
 * Returns the raw better-sqlite3 database instance.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  return db;
}

/**
 * Retrieve all media items with optional filtering, sorting, and pagination.
 *
 * @param {Object}  [filters={}]           - Query filters.
 * @param {string}  [filters.sort]         - Column to sort by (default 'added_at').
 * @param {string}  [filters.order]        - Sort direction: 'ASC' | 'DESC' (default 'DESC').
 * @param {string}  [filters.genre]        - Filter by genre (matched via LIKE since genre is a JSON array string).
 * @param {number}  [filters.year]         - Filter by release year.
 * @param {string}  [filters.type]         - Filter by media_type ('movie', 'series', etc.).
 * @param {number}  [filters.limit]        - Maximum number of results.
 * @param {number}  [filters.offset]       - Number of results to skip (for pagination).
 * @returns {Object[]} Array of media row objects.
 */
function getAllMedia(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.genre) {
    // Genre is stored as a JSON array string, e.g. '["Action","Drama"]'.
    // Use LIKE with the genre name wrapped to match inside the array.
    conditions.push(`genre LIKE @genre`);
    params.genre = `%"${filters.genre.replace(/"/g, '')}"%`;
  }

  if (filters.year != null) {
    conditions.push(`year = @year`);
    params.year = Number(filters.year);
  }

  if (filters.type) {
    conditions.push(`media_type = @type`);
    params.type = filters.type;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = safeSortColumn(filters.sort);
  const sortOrder = safeSortOrder(filters.order);

  let sql = `SELECT * FROM media ${whereClause} ORDER BY ${sortCol} ${sortOrder}`;

  if (filters.limit != null) {
    sql += ` LIMIT @limit`;
    params.limit = Number(filters.limit);
  }

  if (filters.offset != null) {
    sql += ` OFFSET @offset`;
    params.offset = Number(filters.offset);
  }

  try {
    return db.prepare(sql).all(params);
  } catch (err) {
    console.error('[database] getAllMedia error:', err.message);
    return [];
  }
}

/**
 * Retrieve a single media item by its ID.
 *
 * @param {number} id - Media ID.
 * @returns {Object|undefined} The media row, or undefined if not found.
 */
function getMediaById(id) {
  try {
    return stmt(
      'getMediaById',
      'SELECT * FROM media WHERE id = ?',
    ).get(id);
  } catch (err) {
    console.error('[database] getMediaById error:', err.message);
    return undefined;
  }
}

/**
 * Get the most recently added media items.
 *
 * @param {number} [limit=20] - Maximum number of items to return.
 * @returns {Object[]} Array of media row objects.
 */
function getRecentlyAdded(limit = 20) {
  try {
    return stmt(
      'getRecentlyAdded',
      'SELECT * FROM media ORDER BY added_at DESC LIMIT ?',
    ).all(limit);
  } catch (err) {
    console.error('[database] getRecentlyAdded error:', err.message);
    return [];
  }
}

/**
 * Get recently played media (from watch history), joined with media details.
 *
 * @param {number} [limit=20] - Maximum number of items to return.
 * @returns {Object[]} Array of joined media + watch_history rows.
 */
function getRecentlyPlayed(limit = 20) {
  try {
    return stmt(
      'getRecentlyPlayed',
      `SELECT m.*, wh.progress, wh.duration AS watch_duration, wh.completed,
              wh.last_watched, wh.watch_count
       FROM watch_history wh
       INNER JOIN media m ON m.id = wh.media_id
       ORDER BY wh.last_watched DESC
       LIMIT ?`,
    ).all(limit);
  } catch (err) {
    console.error('[database] getRecentlyPlayed error:', err.message);
    return [];
  }
}

/**
 * Get media items that have been started but not finished (continue watching).
 *
 * @param {number} [limit=20] - Maximum number of items to return.
 * @returns {Object[]} Array of joined media + watch_history rows.
 */
function getContinueWatching(limit = 20) {
  try {
    return stmt(
      'getContinueWatching',
      `SELECT m.*, wh.progress, wh.duration AS watch_duration, wh.completed,
              wh.last_watched, wh.watch_count
       FROM watch_history wh
       INNER JOIN media m ON m.id = wh.media_id
       WHERE wh.completed = 0 AND wh.progress > 0
       ORDER BY wh.last_watched DESC
       LIMIT ?`,
    ).all(limit);
  } catch (err) {
    console.error('[database] getContinueWatching error:', err.message);
    return [];
  }
}

/**
 * Search media by title using a LIKE query.
 *
 * @param {string} query - Search term.
 * @returns {Object[]} Array of matching media rows.
 */
function searchMedia(query) {
  if (!query || typeof query !== 'string') return [];

  try {
    return stmt(
      'searchMedia',
      `SELECT * FROM media WHERE title LIKE ? ORDER BY title ASC`,
    ).all(`%${query}%`);
  } catch (err) {
    console.error('[database] searchMedia error:', err.message);
    return [];
  }
}

/**
 * Insert a new media item or update an existing one identified by file_path.
 *
 * Uses INSERT … ON CONFLICT(file_path) DO UPDATE to perform an upsert.
 * Accepts an object whose keys correspond to the media table columns.
 *
 * @param {Object} data - Media data object.
 * @param {string} data.title - Title of the media (required).
 * @param {string} data.file_path - Absolute file path (required, used as unique key).
 * @param {string} [data.original_filename]
 * @param {string} [data.source_type]
 * @param {string} [data.media_type]
 * @param {number} [data.tmdb_id]
 * @param {number} [data.year]
 * @param {string} [data.genre] - JSON array string, e.g. '["Action","Drama"]'.
 * @param {string} [data.overview]
 * @param {number} [data.rating]
 * @param {number} [data.runtime]
 * @param {string} [data.poster_path]
 * @param {string} [data.backdrop_path]
 * @param {string} [data.local_thumbnail]
 * @param {string} [data.video_codec]
 * @param {string} [data.audio_codec]
 * @param {string} [data.resolution]
 * @param {number} [data.file_size]
 * @param {number} [data.duration]
 * @param {string} [data.subtitle_tracks]
 * @param {string} [data.audio_tracks]
 * @returns {import('better-sqlite3').RunResult} The result of the upsert operation.
 */
function upsertMedia(data) {
  const sql = `
    INSERT INTO media (
      title, original_filename, file_path, source_type, media_type,
      tmdb_id, year, genre, overview, rating, runtime,
      poster_path, backdrop_path, local_thumbnail,
      video_codec, audio_codec, resolution, file_size, duration,
      subtitle_tracks, audio_tracks
    ) VALUES (
      @title, @original_filename, @file_path, @source_type, @media_type,
      @tmdb_id, @year, @genre, @overview, @rating, @runtime,
      @poster_path, @backdrop_path, @local_thumbnail,
      @video_codec, @audio_codec, @resolution, @file_size, @duration,
      @subtitle_tracks, @audio_tracks
    )
    ON CONFLICT(file_path) DO UPDATE SET
      title            = CASE WHEN media.metadata_locked = 1 OR (media.tmdb_id IS NOT NULL AND excluded.tmdb_id IS NULL) THEN media.title ELSE excluded.title END,
      original_filename = excluded.original_filename,
      source_type      = excluded.source_type,
      media_type       = CASE WHEN media.metadata_locked = 1 THEN media.media_type ELSE excluded.media_type END,
      tmdb_id          = CASE WHEN media.metadata_locked = 1 THEN media.tmdb_id ELSE COALESCE(excluded.tmdb_id, media.tmdb_id) END,
      year             = CASE WHEN media.metadata_locked = 1 THEN media.year ELSE COALESCE(excluded.year, media.year) END,
      genre            = CASE WHEN media.metadata_locked = 1 THEN media.genre ELSE COALESCE(excluded.genre, media.genre) END,
      overview         = CASE WHEN media.metadata_locked = 1 THEN media.overview ELSE COALESCE(excluded.overview, media.overview) END,
      rating           = CASE WHEN media.metadata_locked = 1 THEN media.rating ELSE COALESCE(excluded.rating, media.rating) END,
      runtime          = CASE WHEN media.metadata_locked = 1 THEN media.runtime ELSE COALESCE(excluded.runtime, media.runtime) END,
      poster_path      = CASE WHEN media.metadata_locked = 1 THEN media.poster_path ELSE COALESCE(excluded.poster_path, media.poster_path) END,
      backdrop_path    = CASE WHEN media.metadata_locked = 1 THEN media.backdrop_path ELSE COALESCE(excluded.backdrop_path, media.backdrop_path) END,
      local_thumbnail  = COALESCE(excluded.local_thumbnail, media.local_thumbnail),
      video_codec      = COALESCE(excluded.video_codec, media.video_codec),
      audio_codec      = COALESCE(excluded.audio_codec, media.audio_codec),
      resolution       = COALESCE(excluded.resolution, media.resolution),
      file_size        = COALESCE(excluded.file_size, media.file_size),
      duration         = COALESCE(excluded.duration, media.duration),
      subtitle_tracks  = COALESCE(excluded.subtitle_tracks, media.subtitle_tracks),
      audio_tracks     = COALESCE(excluded.audio_tracks, media.audio_tracks),
      updated_at       = CURRENT_TIMESTAMP
  `;

  // Normalise input – fill any missing optional fields with null.
  const params = {
    title: data.title,
    original_filename: data.original_filename ?? null,
    file_path: data.file_path,
    source_type: data.source_type ?? 'local',
    media_type: data.media_type ?? 'movie',
    tmdb_id: data.tmdb_id ?? null,
    year: data.year ?? null,
    genre: data.genre ?? null,
    overview: data.overview ?? null,
    rating: data.rating ?? null,
    runtime: data.runtime ?? null,
    poster_path: data.poster_path ?? null,
    backdrop_path: data.backdrop_path ?? null,
    local_thumbnail: data.local_thumbnail ?? null,
    video_codec: data.video_codec ?? null,
    audio_codec: data.audio_codec ?? null,
    resolution: data.resolution ?? null,
    file_size: data.file_size ?? null,
    duration: data.duration ?? null,
    subtitle_tracks: data.subtitle_tracks ?? null,
    audio_tracks: data.audio_tracks ?? null,
  };

  try {
    return stmt('upsertMedia', sql).run(params);
  } catch (err) {
    console.error('[database] upsertMedia error:', err.message);
    return { changes: 0 };
  }
}

function insertDiscoveredMedia(data) {
  return db.prepare(`INSERT OR IGNORE INTO media
    (title, original_filename, file_path, source_type, media_type, file_size)
    VALUES (@title, @original_filename, @file_path, @source_type, @media_type, @file_size)`)
    .run(data);
}

function updateMediaTechnical(id, info) {
  return db.prepare(`UPDATE media SET
    video_codec = @video_codec, audio_codec = @audio_codec,
    resolution = @resolution, duration = @duration,
    file_size = COALESCE(@file_size, file_size),
    subtitle_tracks = @subtitle_tracks, audio_tracks = @audio_tracks,
    updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
      id,
      video_codec: info.video_codec,
      audio_codec: info.audio_codec,
      resolution: info.resolution,
      duration: info.duration,
      file_size: info.file_size,
      subtitle_tracks: JSON.stringify(info.subtitle_tracks || []),
      audio_tracks: JSON.stringify(info.audio_tracks || []),
    });
}

function setMediaTmdbInfo(id, info) {
  return db.prepare(`UPDATE media SET
    title = @title, media_type = @media_type, tmdb_id = @tmdb_id,
    year = @year, genre = @genre, overview = @overview,
    rating = @rating, runtime = @runtime, poster_path = @poster_path,
    backdrop_path = @backdrop_path, metadata_locked = 1,
    updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id, ...info });
}

function clearMediaTmdbInfo(id, title, mediaType) {
  return db.prepare(`UPDATE media SET
    title = ?, media_type = ?, tmdb_id = NULL, year = NULL,
    genre = NULL, overview = NULL, rating = NULL, runtime = NULL,
    poster_path = NULL, backdrop_path = NULL, metadata_locked = 1,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(title, mediaType, id);
}

/**
 * Extract all distinct genres from the media table.
 *
 * Genre is stored as a JSON array string (e.g. '["Action","Drama"]').
 * This function collects every genre value from every row, parses the JSON,
 * and returns a sorted array of unique genre names.
 *
 * @returns {string[]} Sorted array of unique genre names.
 */
function getAllGenres() {
  try {
    const rows = stmt(
      'getAllGenres',
      `SELECT genre FROM media WHERE genre IS NOT NULL AND genre != ''`,
    ).all();

    /** @type {Set<string>} */
    const genreSet = new Set();

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.genre);
        if (Array.isArray(parsed)) {
          for (const g of parsed) {
            if (typeof g === 'string' && g.trim().length > 0) {
              genreSet.add(g.trim());
            }
          }
        }
      } catch {
        // If the genre field is a plain comma-separated string, handle that too.
        if (typeof row.genre === 'string') {
          for (const g of row.genre.split(',')) {
            const trimmed = g.replace(/[[\]"]/g, '').trim();
            if (trimmed.length > 0) genreSet.add(trimmed);
          }
        }
      }
    }

    return Array.from(genreSet).sort();
  } catch (err) {
    console.error('[database] getAllGenres error:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Watch history
// ---------------------------------------------------------------------------

/**
 * Update or insert watch progress for a media item.
 *
 * Automatically marks the item as completed if `progress / duration > 0.9`.
 * On re-watch (item already exists), increments watch_count.
 *
 * @param {number} mediaId  - The media item ID.
 * @param {number} progress - Current playback position in seconds.
 * @param {number} duration - Total duration of the media in seconds.
 * @returns {import('better-sqlite3').RunResult}
 */
function updateWatchProgress(mediaId, progress, duration) {
  const completed = (duration > 0 && progress / duration > 0.9) ? 1 : 0;

  const sql = `
    INSERT INTO watch_history (media_id, progress, duration, completed, last_watched, watch_count)
    VALUES (@mediaId, @progress, @duration, @completed, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(media_id) DO UPDATE SET
      progress     = @progress,
      duration     = @duration,
      completed    = @completed,
      last_watched = CURRENT_TIMESTAMP,
      watch_count  = CASE
                       WHEN @completed = 1 AND watch_history.completed = 1
                       THEN watch_history.watch_count + 1
                       ELSE watch_history.watch_count
                     END
  `;

  try {
    return stmt('updateWatchProgress', sql).run({
      mediaId,
      progress,
      duration,
      completed,
    });
  } catch (err) {
    console.error('[database] updateWatchProgress error:', err.message);
    return { changes: 0 };
  }
}

/**
 * Get watch progress for a specific media item.
 *
 * @param {number} mediaId - The media item ID.
 * @returns {Object|undefined} Watch history row, or undefined if none.
 */
function getWatchHistory(mediaId) {
  try {
    return stmt(
      'getWatchHistory',
      'SELECT * FROM watch_history WHERE media_id = ?',
    ).get(mediaId);
  } catch (err) {
    console.error('[database] getWatchHistory error:', err.message);
    return undefined;
  }
}

/**
 * Get full watch history joined with media details.
 *
 * @returns {Object[]} Array of joined watch_history + media rows.
 */
function getAllWatchHistory() {
  try {
    return stmt(
      'getAllWatchHistory',
      `SELECT m.*, wh.progress, wh.duration AS watch_duration, wh.completed,
              wh.last_watched, wh.watch_count
       FROM watch_history wh
       INNER JOIN media m ON m.id = wh.media_id
       ORDER BY wh.last_watched DESC`,
    ).all();
  } catch (err) {
    console.error('[database] getAllWatchHistory error:', err.message);
    return [];
  }
}

/**
 * Delete watch history for a specific media item.
 *
 * @param {number} mediaId - The media item ID.
 * @returns {import('better-sqlite3').RunResult}
 */
function deleteWatchHistory(mediaId) {
  try {
    return stmt(
      'deleteWatchHistory',
      'DELETE FROM watch_history WHERE media_id = ?',
    ).run(mediaId);
  } catch (err) {
    console.error('[database] deleteWatchHistory error:', err.message);
    return { changes: 0 };
  }
}

// ---------------------------------------------------------------------------
// Library sources
// ---------------------------------------------------------------------------

/**
 * Add a new library source.
 *
 * @param {Object} data              - Library source data.
 * @param {string} data.name         - Display name of the source.
 * @param {string} data.path         - File system path.
 * @param {string} [data.source_type='local'] - Source type (e.g. 'local', 'smb', 'url').
 * @returns {import('better-sqlite3').RunResult}
 */
function addLibrarySource(data) {
  try {
    return stmt(
      'addLibrarySource',
      `INSERT INTO library_sources (name, path, source_type, item_kind, enabled) VALUES (@name, @path, @source_type, @item_kind, @enabled)`,
    ).run({
      name: data.name,
      path: data.path,
      source_type: data.source_type ?? 'local',
      item_kind: data.item_kind ?? 'folder',
      enabled: data.enabled ?? 1,
    });
  } catch (err) {
    console.error('[database] addLibrarySource error:', err.message);
    return { changes: 0 };
  }
}

/**
 * List all library sources.
 *
 * @returns {Object[]} Array of library source rows.
 */
function getLibrarySources() {
  try {
    return stmt(
      'getLibrarySources',
      'SELECT * FROM library_sources ORDER BY created_at DESC',
    ).all();
  } catch (err) {
    console.error('[database] getLibrarySources error:', err.message);
    return [];
  }
}

/**
 * Update an existing library source by ID.
 *
 * Only the fields present in the `data` object are updated.
 *
 * @param {number} id   - Library source ID.
 * @param {Object} data - Fields to update (name, path, source_type, enabled, last_scanned).
 * @returns {import('better-sqlite3').RunResult}
 */
function updateLibrarySource(id, data) {
  const updatable = ['name', 'path', 'source_type', 'enabled', 'last_scanned'];
  const setClauses = [];
  const params = { id };

  for (const col of updatable) {
    if (data[col] !== undefined) {
      setClauses.push(`${col} = @${col}`);
      params[col] = data[col];
    }
  }

  if (setClauses.length === 0) return { changes: 0 };

  const sql = `UPDATE library_sources SET ${setClauses.join(', ')} WHERE id = @id`;

  try {
    return db.prepare(sql).run(params);
  } catch (err) {
    console.error('[database] updateLibrarySource error:', err.message);
    return { changes: 0 };
  }
}

/**
 * Delete a library source and optionally all media that were sourced from its path.
 *
 * @param {number}  id              - Library source ID.
 * @param {boolean} [deleteMedia=false] - If true, also delete media whose file_path starts with the source path.
 * @returns {import('better-sqlite3').RunResult}
 */
function deleteLibrarySource(id, deleteMedia = false) {
  try {
    if (deleteMedia) {
      const source = stmt(
        'getLibrarySourceById',
        'SELECT * FROM library_sources WHERE id = ?',
      ).get(id);

      if (source) {
        db.prepare('DELETE FROM media WHERE file_path LIKE ?').run(`${source.path}%`);
      }
    }

    return stmt(
      'deleteLibrarySource',
      'DELETE FROM library_sources WHERE id = ?',
    ).run(id);
  } catch (err) {
    console.error('[database] deleteLibrarySource error:', err.message);
    return { changes: 0 };
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Get a setting value by key.
 *
 * @param {string} key - Setting key.
 * @returns {string|undefined} The setting value, or undefined if not found.
 */
function getSetting(key) {
  try {
    const row = stmt(
      'getSetting',
      'SELECT value FROM settings WHERE key = ?',
    ).get(key);
    return row ? row.value : undefined;
  } catch (err) {
    console.error('[database] getSetting error:', err.message);
    return undefined;
  }
}

/**
 * Set (upsert) a setting value.
 *
 * @param {string} key   - Setting key.
 * @param {string} value - Setting value.
 * @returns {import('better-sqlite3').RunResult}
 */
function setSetting(key, value) {
  try {
    return stmt(
      'setSetting',
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  } catch (err) {
    console.error('[database] setSetting error:', err.message);
    return { changes: 0 };
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Gracefully close the database connection.
 * Should be called on application shutdown.
 */
function closeDb() {
  try {
    db.close();
    console.log('[database] Connection closed.');
  } catch (err) {
    console.error('[database] Error closing database:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getDb,
  getAllMedia,
  getMediaById,
  getRecentlyAdded,
  getRecentlyPlayed,
  getContinueWatching,
  searchMedia,
  upsertMedia,
  insertDiscoveredMedia,
  updateMediaTechnical,
  setMediaTmdbInfo,
  clearMediaTmdbInfo,
  getAllGenres,
  updateWatchProgress,
  getWatchHistory,
  getAllWatchHistory,
  deleteWatchHistory,
  addLibrarySource,
  getLibrarySources,
  updateLibrarySource,
  deleteLibrarySource,
  getSetting,
  setSetting,
  closeDb,
};
