/**
 * DS PLIX API Client
 * All fetch calls to the backend REST API.
 */
window.DSPlixAPI = {
  // ── Media ──
  async getMedia(params = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '' && v !== 'all') qs.set(k, v); });
    return this._get(`/api/media?${qs.toString()}`);
  },
  async getMediaById(id) { return this._get(`/api/media/${id}`); },
  async getRecentlyAdded(limit = 20) { return this._get(`/api/media/recently-added?limit=${limit}`); },
  async getRecentlyPlayed(limit = 20) { return this._get(`/api/media/recently-played?limit=${limit}`); },
  async getContinueWatching(limit = 20) { return this._get(`/api/media/continue-watching?limit=${limit}`); },
  async getGenres() { return this._get('/api/media/genres'); },
  async searchMedia(query) { return this._get(`/api/media/search?q=${encodeURIComponent(query)}`); },
  async rematchMedia(id, data) { return this._post(`/api/media/${id}/match`, data); },
  async searchTmdbForMedia(id, query) { return this._get(`/api/media/${id}/tmdb-search?q=${encodeURIComponent(query)}`); },
  async removeMediaInfo(id) { return this._delete(`/api/media/${id}/match`); },

  // ── Streaming (URL builders — sync) ──
  getStreamUrl(id) { return `/api/stream/${id}`; },
  getHLSUrl(id) { return `/api/stream/${id}/hls/master.m3u8`; },
  getSubtitleUrl(id, trackIndex) { return `/api/stream/${id}/subtitle/${trackIndex}`; },
  getThumbnailUrl(id) { return `/api/stream/${id}/thumbnail`; },
  async getStreamInfo(id) { return this._get(`/api/stream/${id}/info`); },
  async getSubtitles(id) { return this._get(`/api/subtitles/${id}`); },
  async uploadSubtitle(id, file, language) {
    const qs = new URLSearchParams({ filename: file.name, language, label: file.name });
    const res = await fetch(`/api/subtitles/${id}/local?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    return res.ok ? res.json() : { error: (await res.json().catch(() => ({}))).error || 'Upload failed' };
  },
  async searchSubtitles(id, language) {
    const res = await fetch(`/api/subtitles/${id}/online?language=${encodeURIComponent(language)}`);
    return res.json();
  },
  async downloadSubtitle(id, data) {
    const res = await fetch(`/api/subtitles/${id}/online`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
  },
  async removeSubtitle(id, subtitleId) { return this._delete(`/api/subtitles/${id}/${subtitleId}`); },
  getExternalSubtitleUrl(id, subtitleId) { return `/api/subtitles/${id}/${subtitleId}/file`; },
  async openPrivate(path) { return this._post('/api/private/open', { path }); },
  async closePrivate(token) { return this._delete(`/api/private/${token}`); },

  // ── History ──
  async updateProgress(mediaId, progress, duration) {
    return this._post(`/api/history/${mediaId}`, { progress, duration });
  },
  async getHistory(limit = 50) { return this._get(`/api/history?limit=${limit}`); },
  async deleteHistory(mediaId) { return this._delete(`/api/history/${mediaId}`); },

  // ── Library ──
  async getLibrarySources() { return this._get('/api/library/sources'); },
  async getLocalLocations() { return this._get('/api/library/local/locations'); },
  async browseLocalFolder(path) { return this._get(`/api/library/local/browse?path=${encodeURIComponent(path)}`); },
  async addLocalItems(items) { return this._post('/api/library/local/add', { items }); },
  async browseSourceFolder(id, path = '') { return this._get(`/api/library/sources/${id}/browse?path=${encodeURIComponent(path)}`); },
  async addSourceFolder(id, path) { return this._post(`/api/library/sources/${id}/folders`, { path }); },
  async addLibrarySource(data) {
    try {
      const res = await fetch('/api/library/sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      return await res.json();
    } catch (err) {
      console.error('[API]', err);
      return { error: 'Could not reach the app server' };
    }
  },
  async updateLibrarySource(id, data) { return this._put(`/api/library/sources/${id}`, data); },
  async deleteLibrarySource(id) { return this._delete(`/api/library/sources/${id}`); },
  async triggerScan(sourceId = null) {
    const url = sourceId ? `/api/library/scan/${sourceId}` : '/api/library/scan';
    return this._post(url);
  },
  async getScanStatus() { return this._get('/api/library/scan/status'); },

  // ── Settings ──
  async getSettings() { return this._get('/api/settings'); },
  async updateSettings(data) { return this._put('/api/settings', data); },
  async addStreamLink(data) { return this._post('/api/settings/stream-link', data); },
  async getSystemInfo() { return this._get('/api/settings/system-info'); },
  async scanNetwork() { return this._get('/api/settings/network-scan'); },
  async browseNetwork(path, type) {
    const qs = new URLSearchParams();
    qs.set('path', path);
    qs.set('type', type);
    return this._get(`/api/settings/browse?${qs.toString()}`);
  },

  // ── Internal helpers ──
  async _get(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
      return await res.json();
    } catch (err) { console.error('[API]', err); return null; }
  },
  async _post(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
      return await res.json();
    } catch (err) { console.error('[API]', err); return null; }
  },
  async _put(url, body) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PUT ${url} → ${res.status}`);
      return await res.json();
    } catch (err) { console.error('[API]', err); return null; }
  },
  async _delete(url) {
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error(`DELETE ${url} → ${res.status}`);
      return await res.json();
    } catch (err) { console.error('[API]', err); return null; }
  },
};
