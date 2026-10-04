const router = require('express').Router();
const path = require('path');
const {
  getAllMedia,
  getMediaById,
  getRecentlyAdded,
  getRecentlyPlayed,
  getContinueWatching,
  searchMedia,
  getAllGenres,
  getWatchHistory,
  setMediaTmdbInfo,
  clearMediaTmdbInfo,
} = require('../db/database');
const { searchMulti, getMovieDetails, getTVDetails } = require('../services/tmdb');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Allowed sort columns – prevents SQL injection via whitelist */
const ALLOWED_SORTS = new Set(['title', 'year', 'rating', 'added_at', 'duration', 'file_size']);
const ALLOWED_ORDERS = new Set(['asc', 'desc']);
const ALLOWED_TYPES = new Set(['movie', 'tv', 'all']);

/**
 * Parse a positive-integer query param with a default value.
 * Returns the default when the value is missing, NaN, or ≤ 0.
 */
function positiveInt(raw, defaultVal) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

// ---------------------------------------------------------------------------
// GET /api/media — list all media with optional filters & pagination
// ---------------------------------------------------------------------------
router.get('/', (req, res, next) => {
  try {
    const sort = ALLOWED_SORTS.has(req.query.sort) ? req.query.sort : 'added_at';
    const order = ALLOWED_ORDERS.has(req.query.order) ? req.query.order : 'desc';
    const type = ALLOWED_TYPES.has(req.query.type) ? req.query.type : 'all';
    const genre = typeof req.query.genre === 'string' ? req.query.genre.trim() : null;
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const limit = positiveInt(req.query.limit, 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const filters = { sort, order, genre, year, limit, offset };
    if (type !== 'all') filters.type = type;

    const items = getAllMedia(filters);
    const genres = getAllGenres();

    res.json({ items, total: items.length, genres });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/media/recently-added
// ---------------------------------------------------------------------------
router.get('/recently-added', async (req, res, next) => {
  try {
    const limit = positiveInt(req.query.limit, 20);
    const items = await getRecentlyAdded(limit);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/media/recently-played
// ---------------------------------------------------------------------------
router.get('/recently-played', async (req, res, next) => {
  try {
    const limit = positiveInt(req.query.limit, 20);
    const items = await getRecentlyPlayed(limit);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/media/continue-watching — items with progress < 90%
// ---------------------------------------------------------------------------
router.get('/continue-watching', async (req, res, next) => {
  try {
    const limit = positiveInt(req.query.limit, 20);
    const items = await getContinueWatching(limit);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/media/genres
// ---------------------------------------------------------------------------
router.get('/genres', async (req, res, next) => {
  try {
    const genres = await getAllGenres();
    res.json({ genres });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/media/search?q=query
// ---------------------------------------------------------------------------
router.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.json({ items: [] });
    }
    const items = await searchMedia(q);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/media/:id — single media item with watch history
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Attach watch history for this item (may be null)
    let watchHistory = null;
    try {
      watchHistory = await getWatchHistory(req.params.id);
    } catch (_) {
      // Watch history is optional; swallow errors silently
    }

    res.json({ ...media, watchHistory: watchHistory || null });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/media/:id/tmdb-search — let the user choose an exact match
// ---------------------------------------------------------------------------
router.get('/:id/tmdb-search', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2 || query.length > 120) return res.status(400).json({ error: 'Enter 2–120 characters' });
    const results = await searchMulti(query);
    if (!Array.isArray(results)) return res.status(502).json({ error: 'TMDB is unavailable. Try again shortly.' });
    res.json({ results: results.filter(item => ['movie', 'tv'].includes(item.media_type)).slice(0, 15).map(item => ({
      id: item.id,
      media_type: item.media_type,
      title: item.title || item.name,
      year: (item.release_date || item.first_air_date || '').slice(0, 4),
      overview: item.overview || '',
      poster_path: item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : null,
    })) });
  } catch (err) {
    next(err);
  }
});

// POST /api/media/:id/match — apply the specific TMDB title the user picked
router.post('/:id/match', async (req, res, next) => {
  try {
    const media = getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });
    const { tmdb_id, media_type } = req.body || {};
    const id = Number(tmdb_id);
    if (!Number.isSafeInteger(id) || id <= 0 || !['movie', 'tv'].includes(media_type)) {
      return res.status(400).json({ error: 'Choose a movie or TV result' });
    }
    const details = media_type === 'movie' ? await getMovieDetails(id) : await getTVDetails(id);
    if (!details) return res.status(502).json({ error: 'TMDB details unavailable' });
    const release = details.release_date || details.first_air_date || '';
    setMediaTmdbInfo(media.id, {
      title: details.title || details.name || media.title,
      media_type,
      tmdb_id: id,
      year: /^\d{4}/.test(release) ? Number(release.slice(0, 4)) : null,
      genre: JSON.stringify((details.genres || []).map(genre => genre.name)),
      overview: details.overview || null,
      rating: details.vote_average ?? null,
      runtime: media_type === 'movie' ? details.runtime ?? null : details.episode_run_time?.[0] ?? null,
      poster_path: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
      backdrop_path: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : null,
    });
    res.json(getMediaById(media.id));
  } catch (err) { next(err); }
});

// DELETE /api/media/:id/match — remove TMDB data and keep it removed on rescans
router.delete('/:id/match', (req, res, next) => {
  try {
    const media = getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });
    const filename = media.original_filename || path.basename(media.file_path);
    const title = path.parse(filename).name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() || media.title;
    const mediaType = /\bS\d{1,2}E\d{1,2}\b/i.test(filename) ? 'tv' : 'movie';
    clearMediaTmdbInfo(media.id, title, mediaType);
    res.json(getMediaById(media.id));
  } catch (err) { next(err); }
});

module.exports = router;
