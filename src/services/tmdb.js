/**
 * @fileoverview TMDB (The Movie Database) API service module.
 * Provides methods for searching movies/TV shows, fetching details,
 * retrieving genres, constructing image URLs, and matching local media
 * against TMDB metadata. Uses an LRU-style cache and rate limiting.
 * @module services/tmdb
 */

'use strict';

const { getSetting } = require('../db/database');
const https = require('https');
const tmdbAgent = new https.Agent({ family: 4, keepAlive: true, maxSockets: 2 });

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: tmdbAgent, timeout: 12000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(body) }); }
        catch (err) { reject(err); }
      });
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('TMDB request timed out')));
    req.on('error', reject);
  });
}

/** @constant {string} BASE_URL - TMDB API v3 base URL */
const BASE_URL = 'https://api.themoviedb.org/3';

/** @constant {string} IMAGE_BASE_URL - TMDB image CDN base URL */
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/';

/** @constant {number} MAX_CACHE_SIZE - Maximum number of cached responses */
const MAX_CACHE_SIZE = 500;

/** @constant {number} RATE_LIMIT_MS - Minimum delay between API requests in milliseconds */
const RATE_LIMIT_MS = 125;

/**
 * TMDB API service class.
 * Handles all communication with the TMDB REST API, including caching,
 * rate limiting, and response normalization.
 */
class TMDBService {
  /**
   * Creates a new TMDBService instance.
   * @param {string} apiKey - TMDB API key for authentication.
   */
  constructor(apiKey, request = requestJson) {
    /** @type {string} */
    this.apiKey = apiKey;
    this._transport = request;
    this._queue = Promise.resolve();

    /**
     * LRU-style response cache.
     * Uses Map insertion order to track age; oldest entries are evicted first.
     * @type {Map<string, object>}
     * @private
     */
    this._cache = new Map();

    /**
     * Timestamp of the last API request, used for rate limiting.
     * @type {number}
     * @private
     */
    this._lastRequestTime = 0;
  }

  /**
   * Makes a rate-limited, cached request to the TMDB API.
   * Checks the LRU cache first. On a cache miss, enforces a minimum delay
   * between requests, fetches from the API, and caches successful responses.
   * Evicts the oldest cache entry when the cache exceeds MAX_CACHE_SIZE.
   *
   * @param {string} endpoint - The API endpoint path (e.g., '/search/movie').
   * @param {Object<string, string|number>} [params={}] - Query parameters to include.
   * @returns {Promise<object|null>} Parsed JSON response, or null on error.
   * @private
   */
  async _request(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set('api_key', this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const cacheKey = url.toString();

    // Check cache (move to "newest" position on hit for LRU behavior)
    if (this._cache.has(cacheKey)) {
      const cached = this._cache.get(cacheKey);
      this._cache.delete(cacheKey);
      this._cache.set(cacheKey, cached);
      return cached;
    }

    const run = async () => {
      if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
      for (let attempt = 0; attempt < 3; attempt++) {
        const delay = Math.max(0, RATE_LIMIT_MS - (Date.now() - this._lastRequestTime));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        this._lastRequestTime = Date.now();
        try {
          const response = await this._transport(cacheKey);
          if (response.status === 429 || response.status >= 500) {
            if (attempt < 2) {
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
              continue;
            }
          }
          if (response.status !== 200) {
            console.warn(`[TMDBService] HTTP ${response.status} for ${endpoint}`);
            return null;
          }
          const data = response.data;
          if (this._cache.size >= MAX_CACHE_SIZE) this._cache.delete(this._cache.keys().next().value);
          this._cache.set(cacheKey, data);
          return data;
        } catch (err) {
          if (attempt === 2) {
            console.warn(`[TMDBService] ${endpoint} failed after retries: ${err.code || err.message}`);
            return null;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      return null;
    };
    const pending = this._queue.then(run, run);
    this._queue = pending.then(() => {}, () => {});
    return pending;
  }

  /**
   * Searches TMDB for movies matching the given title and optional year.
   *
   * @param {string} title - The movie title to search for.
   * @param {number|string} [year] - Optional release year to narrow results.
   * @returns {Promise<Array<object>>} Array of movie result objects, or empty array on failure.
   */
  async searchMovie(title, year) {
    const params = { query: title };
    if (year) {
      params.year = year;
    }
    const data = await this._request('/search/movie', params);
    return data?.results || [];
  }

  /**
   * Searches TMDB for TV shows matching the given title.
   *
   * @param {string} title - The TV show title to search for.
   * @returns {Promise<Array<object>>} Array of TV show result objects, or empty array on failure.
   */
  async searchTV(title) {
    const data = await this._request('/search/tv', { query: title });
    return data?.results || [];
  }

  /**
   * Searches TMDB across movies, TV shows, and people simultaneously.
   *
   * @param {string} query - The search query string.
   * @returns {Promise<Array<object>>} Array of multi-search result objects, or empty array on failure.
   */
  async searchMulti(query) {
    const data = await this._request('/search/multi', { query });
    return data?.results ?? null;
  }

  /**
   * Fetches full movie details from TMDB, including credits and images.
   *
   * @param {number|string} id - The TMDB movie ID.
   * @returns {Promise<object|null>} Movie details object with appended credits and images, or null on error.
   */
  async getMovieDetails(id) {
    return this._request(`/movie/${id}`);
  }

  /**
   * Fetches full TV show details from TMDB, including credits and images.
   *
   * @param {number|string} id - The TMDB TV show ID.
   * @returns {Promise<object|null>} TV show details object with appended credits and images, or null on error.
   */
  async getTVDetails(id) {
    return this._request(`/tv/${id}`);
  }

  /**
   * Fetches and merges all movie and TV genre lists from TMDB.
   * Deduplicates genres by ID, keeping the first occurrence.
   *
   * @returns {Promise<Array<{id: number, name: string}>>} Deduplicated array of genre objects.
   */
  async getGenres() {
    const [movieGenres, tvGenres] = await Promise.all([
      this._request('/genre/movie/list'),
      this._request('/genre/tv/list'),
    ]);

    const genreMap = new Map();

    if (movieGenres?.genres) {
      for (const genre of movieGenres.genres) {
        if (!genreMap.has(genre.id)) {
          genreMap.set(genre.id, { id: genre.id, name: genre.name });
        }
      }
    }

    if (tvGenres?.genres) {
      for (const genre of tvGenres.genres) {
        if (!genreMap.has(genre.id)) {
          genreMap.set(genre.id, { id: genre.id, name: genre.name });
        }
      }
    }

    return Array.from(genreMap.values());
  }

  /**
   * Constructs a full TMDB image URL from a relative path and size.
   *
   * @param {string|null|undefined} path - The relative image path (e.g., '/abc123.jpg').
   * @param {string} [size='w500'] - The image size variant (e.g., 'w200', 'w500', 'original').
   * @returns {string|null} Full image URL, or null if path is falsy.
   */
  getImageUrl(path, size = 'w500') {
    if (!path) {
      return null;
    }
    return `${IMAGE_BASE_URL}${size}${path}`;
  }

  /**
   * Matches a local media title against TMDB and returns normalized metadata.
   * Searches for either a movie or TV show based on the isTVShow flag,
   * retrieves the top result's full details, and returns a standardized
   * metadata object suitable for database storage.
   *
   * @param {string} title - The media title to search for.
   * @param {number|string} [year] - Optional release year for more accurate matching.
   * @param {boolean} [isTVShow=false] - Whether to search TV shows instead of movies.
   * @returns {Promise<object|null>} Normalized metadata object or null if no match found.
   * @property {number} tmdb_id - TMDB unique identifier.
   * @property {string} title - Official title from TMDB.
   * @property {number|null} year - Release year extracted from release/air date.
   * @property {string} genre - JSON array string of genre names (e.g., '["Action","Drama"]').
   * @property {string} overview - Plot summary / description.
   * @property {number} rating - TMDB vote average (0-10 scale).
   * @property {number|null} runtime - Runtime in minutes (movies) or episode run time (TV).
   * @property {string|null} poster_path - Full URL to the poster image.
   * @property {string|null} backdrop_path - Full URL to the backdrop image.
   * @property {string} media_type - Either 'movie' or 'tv'.
   */
  async matchMedia(title, year, isTVShow = false) {
    // Step 1: Search TMDB
    let results;
    if (isTVShow) {
      results = await this.searchTV(title);
    } else {
      results = await this.searchMovie(title, year);
    }

    if (!results || results.length === 0) {
      return null;
    }

    // Step 2: Get the top result's full details
    const topResult = results[0];
    const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const wantedTitle = normalize(title);
    const foundTitle = normalize(isTVShow ? topResult.name : topResult.title);
    const foundYear = Number(String(isTVShow ? topResult.first_air_date : topResult.release_date || '').slice(0, 4));
    if (!wantedTitle || !foundTitle || (!wantedTitle.includes(foundTitle) && !foundTitle.includes(wantedTitle))) return null;
    if (year && foundYear && Math.abs(Number(year) - foundYear) > 1) return null;
    let details;

    if (isTVShow) {
      details = await this.getTVDetails(topResult.id);
    } else {
      details = await this.getMovieDetails(topResult.id);
    }

    if (!details) {
      return null;
    }

    // Step 3: Normalize and return metadata
    const mediaType = isTVShow ? 'tv' : 'movie';

    // Extract genre names as a JSON array string
    const genreNames = (details.genres || []).map((g) => g.name);
    const genreJson = JSON.stringify(genreNames);

    // Extract year from release_date (movie) or first_air_date (TV)
    const dateStr = isTVShow ? details.first_air_date : details.release_date;
    const extractedYear = dateStr ? parseInt(dateStr.substring(0, 4), 10) : null;

    // Extract runtime: movies have `runtime`, TV shows have `episode_run_time` array
    let runtime = null;
    if (isTVShow) {
      runtime =
        details.episode_run_time && details.episode_run_time.length > 0
          ? details.episode_run_time[0]
          : null;
    } else {
      runtime = details.runtime || null;
    }

    return {
      tmdb_id: details.id,
      title: isTVShow ? details.name : details.title,
      year: extractedYear,
      genre: genreJson,
      overview: details.overview || '',
      rating: details.vote_average || 0,
      runtime: runtime,
      poster_path: this.getImageUrl(details.poster_path),
      backdrop_path: this.getImageUrl(details.backdrop_path, 'w1280'),
      media_type: mediaType,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton pattern
// ---------------------------------------------------------------------------

/**
 * Module-level singleton instance of TMDBService.
 * @type {TMDBService|null}
 * @private
 */
let instance = null;

/**
 * Returns the singleton TMDBService instance, creating it lazily on first call.
 * Reads the API key from the TMDB_API_KEY environment variable first,
 * falling back to the 'tmdb_api_key' database setting.
 *
 * @returns {TMDBService|null} The shared TMDBService instance, or null if no API key is available.
 */
function getInstance() {
  let apiKey;
  try {
    apiKey = getSetting('tmdb_api_key') || process.env.TMDB_API_KEY;
  } catch (err) {
    console.error('[TMDBService] Failed to read tmdb_api_key from database:', err.message);
    apiKey = process.env.TMDB_API_KEY;
  }

  if (!apiKey || apiKey === 'your_tmdb_api_key_here') {
      console.warn(
        '[TMDBService] No TMDB API key found. Set TMDB_API_KEY env var or configure in settings.'
      );
    return null;
  }
  if (!instance || instance.apiKey !== apiKey) {
    instance = new TMDBService(apiKey);
  }

  return instance;
}

module.exports = {
  TMDBService,
  getInstance,
  // Convenience functions that delegate to the singleton
  async searchMovie(title, year) { const svc = getInstance(); return svc ? svc.searchMovie(title, year) : []; },
  async searchTV(title) { const svc = getInstance(); return svc ? svc.searchTV(title) : []; },
  async searchMulti(query) { const svc = getInstance(); return svc ? svc.searchMulti(query) : null; },
  async getMovieDetails(id) { const svc = getInstance(); return svc ? svc.getMovieDetails(id) : null; },
  async getTVDetails(id) { const svc = getInstance(); return svc ? svc.getTVDetails(id) : null; },
  async getGenres() { const svc = getInstance(); return svc ? svc.getGenres() : []; },
  getImageUrl(path, size) { const svc = getInstance(); return svc ? svc.getImageUrl(path, size) : null; },
  async matchMedia(title, year, isTVShow) { const svc = getInstance(); return svc ? svc.matchMedia(title, year, isTVShow) : null; },
};
