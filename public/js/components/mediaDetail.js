/**
 * Media Detail Modal Component
 */
window.MediaDetailComponent = {
  _tmdbImageBase: 'https://image.tmdb.org/t/p/',

  async show(mediaId) {
    this._currentMediaId = mediaId;
    const data = await DSPlixAPI.getMediaById(mediaId);
    if (!data) { window.DSPlixApp.showNotification('Could not load media details', 'error'); return; }

    const modal = document.getElementById('media-detail-modal');
    const content = document.getElementById('media-detail-content');

    const backdropUrl = data.backdrop_path
      ? (data.backdrop_path.startsWith('http') ? data.backdrop_path : `${this._tmdbImageBase}w1280${data.backdrop_path}`)
      : (data.poster_path
        ? (data.poster_path.startsWith('http') ? data.poster_path : `${this._tmdbImageBase}w780${data.poster_path}`)
        : '');

    const genres = this._parseGenres(data.genre);
    const rating = data.rating ? data.rating.toFixed(1) : null;
    const subtitles = this._parseTracks(data.subtitle_tracks);
    const audioTracks = this._parseTracks(data.audio_tracks);
    const addedSubtitles = (await DSPlixAPI.getSubtitles(mediaId))?.items || [];
    const hasProgress = data.watchHistory && data.watchHistory.progress > 0;
    const progressPct = hasProgress ? Math.round((data.watchHistory.progress / data.watchHistory.duration) * 100) : 0;

    content.innerHTML = `
      <div class="modal__backdrop">
        ${backdropUrl ? `<img class="modal__backdrop-img" src="${backdropUrl}" alt="">` : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#0a0a0f);"></div>'}
        <div class="modal__backdrop-gradient"></div>
      </div>
      <button class="modal__close" id="modal-close-btn">&times;</button>
      <div class="modal__body">
        <h1 class="modal__title">${this._esc(data.title)}</h1>
        <div class="modal__meta">
          ${data.year ? `<span class="modal__meta-item">${data.year}</span>` : ''}
          ${rating ? `<span class="modal__meta-item modal__meta-item--rating">★ ${rating}</span>` : ''}
          ${data.runtime ? `<span class="modal__meta-item">${this.formatRuntime(data.runtime)}</span>` : ''}
          ${data.media_type ? `<span class="modal__meta-item" style="text-transform:capitalize;">${data.media_type}</span>` : ''}
        </div>
        <div class="modal__genres">
          ${genres.map(g => `<span class="modal__genre-pill">${g}</span>`).join('')}
        </div>
        ${data.overview ? `<p class="modal__overview">${this._esc(data.overview)}</p>` : ''}
        <div class="modal__actions">
          <button class="btn btn--play-large" onclick="window.MediaDetailComponent.hide();window.PlayerComponent.play(${data.id})">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Play
          </button>
          ${hasProgress ? `<button class="btn btn--secondary" onclick="window.MediaDetailComponent.hide();window.PlayerComponent.play(${data.id}, ${data.watchHistory.progress})">
            Resume (${progressPct}%)
          </button>` : ''}
          <button class="btn btn--secondary" id="modal-get-info">${data.tmdb_id ? 'Change info' : 'Get info'}</button>
          ${data.tmdb_id ? '<button class="btn btn--secondary" id="modal-remove-info">Remove info</button>' : ''}
        </div>
        <div class="modal__tmdb-picker" id="modal-tmdb-picker" hidden>
          <label class="modal__section-title" for="modal-tmdb-query">Find a movie or show on TMDB</label>
          <div class="modal__tmdb-search">
            <input id="modal-tmdb-query" type="search" value="${this._esc(data.title)}" maxlength="120" aria-label="Search TMDB titles">
            <button class="btn btn--secondary" id="modal-tmdb-search-btn">Search</button>
          </div>
          <p class="modal__tmdb-status" id="modal-tmdb-status" role="status"></p>
          <div class="modal__tmdb-results" id="modal-tmdb-results"></div>
        </div>

        ${data.original_filename || data.video_codec || data.resolution || data.file_size ? `
        <h3 class="modal__section-title">File Information</h3>
        <div class="modal__file-info">
          ${data.original_filename ? `<span class="modal__file-label">Filename</span><span>${this._esc(data.original_filename)}</span>` : ''}
          ${data.video_codec ? `<span class="modal__file-label">Video</span><span>${data.video_codec}${data.resolution ? ` • ${data.resolution}` : ''}</span>` : ''}
          ${data.audio_codec ? `<span class="modal__file-label">Audio</span><span>${data.audio_codec}</span>` : ''}
          ${data.file_size ? `<span class="modal__file-label">Size</span><span>${this.formatFileSize(data.file_size)}</span>` : ''}
          ${data.duration ? `<span class="modal__file-label">Duration</span><span>${this.formatRuntime(Math.round(data.duration / 60))}</span>` : ''}
        </div>` : ''}

        ${audioTracks.length ? `
        <h3 class="modal__section-title">Audio Tracks</h3>
        <div class="modal__tracks">${audioTracks.map((t, i) => `<span class="modal__track-badge">${t.language || t.title || ('Track ' + (i + 1))}</span>`).join('')}</div>` : ''}

        <h3 class="modal__section-title">Subtitles</h3>
        ${subtitles.length ? `<div class="modal__tracks">${subtitles.map((t, i) => `<span class="modal__track-badge">${this._esc(t.language || t.title || ('Track ' + (i + 1)))}</span>`).join('')}</div>` : ''}
        <div class="modal__subtitle-list">${addedSubtitles.map(item => `<div class="modal__subtitle-item"><span>${this._esc(item.label)} · ${this._esc(item.language)} (${this._esc(item.source)})</span><button class="btn btn--secondary modal__subtitle-remove" data-id="${item.id}" type="button">Remove</button></div>`).join('')}</div>
        <div class="modal__subtitle-controls">
          <button class="btn btn--secondary" id="modal-subtitle-local" type="button">Add local .srt or .vtt</button><input id="modal-subtitle-file" type="file" accept=".srt,.vtt,text/vtt" hidden>
          <label>Language <input id="modal-subtitle-language" type="text" value="en" maxlength="12" aria-label="Subtitle language code"></label>
          <button class="btn btn--secondary" id="modal-subtitle-search" type="button">Find online</button>
        </div>
        <p id="modal-subtitle-status" class="modal__tmdb-status" role="status"></p>
        <div id="modal-subtitle-results" class="modal__tmdb-results"></div>
      </div>`;

    modal.classList.remove('hide');
    document.body.style.overflow = 'hidden';
    document.getElementById('modal-close-btn').addEventListener('click', () => this.hide());
    modal.onclick = (e) => { if (e.target === modal) this.hide(); };
    document.getElementById('modal-get-info').addEventListener('click', () => {
      const picker = document.getElementById('modal-tmdb-picker');
      picker.hidden = !picker.hidden;
      if (!picker.hidden) {
        document.getElementById('modal-tmdb-query').focus();
        this._searchMetadata(data.id);
      }
    });
    document.getElementById('modal-tmdb-search-btn').addEventListener('click', () => this._searchMetadata(data.id));
    document.getElementById('modal-tmdb-query').addEventListener('keydown', event => {
      if (event.key === 'Enter') this._searchMetadata(data.id);
    });
    document.getElementById('modal-remove-info')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      const updated = await DSPlixAPI.removeMediaInfo(data.id);
      if (!updated) {
        event.currentTarget.disabled = false;
        window.DSPlixApp.showNotification('Could not remove TMDB info', 'error');
        return;
      }
      await this.show(data.id);
      window.DSPlixApp.loadInitialData();
      window.DSPlixApp.showNotification('TMDB info removed', 'success');
    });
    document.getElementById('modal-subtitle-local').addEventListener('click', () => document.getElementById('modal-subtitle-file').click());
    document.getElementById('modal-subtitle-file').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const status = document.getElementById('modal-subtitle-status');
      if (file.size > 2 * 1024 * 1024) { status.textContent = 'Subtitle must be 2 MB or smaller.'; return; }
      status.textContent = 'Adding subtitle…';
      const result = await DSPlixAPI.uploadSubtitle(data.id, file, document.getElementById('modal-subtitle-language').value.trim());
      if (result.error) { status.textContent = result.error; return; }
      await this.show(data.id);
    });
    document.getElementById('modal-subtitle-search').addEventListener('click', () => this._searchSubtitles(data.id));
    content.querySelectorAll('.modal__subtitle-remove').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      const removed = await DSPlixAPI.removeSubtitle(data.id, button.dataset.id);
      if (removed) await this.show(data.id);
      else { button.disabled = false; document.getElementById('modal-subtitle-status').textContent = 'Could not remove subtitle.'; }
    }));
  },

  async _searchSubtitles(mediaId) {
    const status = document.getElementById('modal-subtitle-status');
    const resultsEl = document.getElementById('modal-subtitle-results');
    const language = document.getElementById('modal-subtitle-language').value.trim() || 'en';
    status.textContent = 'Searching OpenSubtitles…';
    resultsEl.replaceChildren();
    try {
      const result = await DSPlixAPI.searchSubtitles(mediaId, language);
      if (this._currentMediaId !== mediaId) return;
      if (result.error) { status.textContent = result.error; return; }
      status.textContent = result.items.length ? 'Choose a subtitle to download:' : 'No subtitles found.';
      resultsEl.innerHTML = result.items.map(item => `<button class="modal__tmdb-result modal__subtitle-result" type="button" data-id="${item.id}" data-label="${encodeURIComponent(item.label)}" data-language="${this._esc(item.language)}"><span><strong>${this._esc(item.label)}</strong><small>${this._esc(item.language)} · ${item.downloads} downloads</small></span></button>`).join('');
      resultsEl.querySelectorAll('.modal__subtitle-result').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Downloading subtitle…';
        const saved = await DSPlixAPI.downloadSubtitle(mediaId, {
          fileId: Number(button.dataset.id), label: decodeURIComponent(button.dataset.label), language: button.dataset.language,
        }).catch(error => ({ error: error.message }));
        if (saved.error) { status.textContent = saved.error; button.disabled = false; return; }
        await this.show(mediaId);
      }));
    } catch (error) { status.textContent = error.message || 'Subtitle search failed.'; }
  },

  async _searchMetadata(mediaId) {
    const searchToken = (this._searchToken || 0) + 1;
    this._searchToken = searchToken;
    const query = document.getElementById('modal-tmdb-query').value.trim();
    const status = document.getElementById('modal-tmdb-status');
    const resultsEl = document.getElementById('modal-tmdb-results');
    if (query.length < 2) { status.textContent = 'Enter at least two characters.'; return; }
    status.textContent = 'Searching TMDB…';
    resultsEl.replaceChildren();
    const result = await DSPlixAPI.searchTmdbForMedia(mediaId, query);
    if (this._currentMediaId !== mediaId || this._searchToken !== searchToken || !document.getElementById('modal-tmdb-results')) return;
    if (!result) { status.textContent = 'Search failed. Try again.'; return; }
    status.textContent = result.results.length ? 'Choose the correct title:' : 'No titles found. Try another search.';
    resultsEl.innerHTML = result.results.map(item => `
      <button class="modal__tmdb-result" type="button" data-tmdb-id="${item.id}" data-media-type="${item.media_type}">
        ${item.poster_path ? `<img src="${item.poster_path}" alt="">` : '<span class="modal__tmdb-no-poster">No poster</span>'}
        <span><strong>${this._esc(item.title)}</strong><small>${item.year || 'Year unknown'} · ${item.media_type === 'tv' ? 'TV show' : 'Movie'}</small></span>
      </button>`).join('');
    resultsEl.querySelectorAll('.modal__tmdb-result').forEach(button => {
      button.addEventListener('click', () => this._applyMetadata(mediaId, button));
    });
  },

  async _applyMetadata(mediaId, button) {
    button.disabled = true;
    const status = document.getElementById('modal-tmdb-status');
    status.textContent = 'Saving TMDB info…';
    const updated = await DSPlixAPI.rematchMedia(mediaId, {
      tmdb_id: Number(button.dataset.tmdbId), media_type: button.dataset.mediaType,
    });
    if (!updated) {
      button.disabled = false;
      status.textContent = 'Could not save this title. Try again.';
      return;
    }
    await this.show(mediaId);
    window.DSPlixApp.loadInitialData();
    window.DSPlixApp.showNotification('TMDB info updated', 'success');
  },

  hide() {
    document.getElementById('media-detail-modal').classList.add('hide');
    document.body.style.overflow = '';
  },

  formatRuntime(minutes) {
    if (!minutes || minutes <= 0) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },

  formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
    return (bytes / 1024).toFixed(0) + ' KB';
  },

  _parseGenres(genre) {
    if (!genre) return [];
    try { return JSON.parse(genre); } catch { return genre.split(',').map(g => g.trim()).filter(Boolean); }
  },

  _parseTracks(tracks) {
    if (!tracks) return [];
    try { return JSON.parse(tracks); } catch { return []; }
  },

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
};
