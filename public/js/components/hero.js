/**
 * Hero Banner Component
 */
window.HeroComponent = {
  _tmdbImageBase: 'https://image.tmdb.org/t/p/',
  _items: [],
  _index: 0,
  _timer: null,
  _hero: null,
  _visibilityHandler: null,

  getFeatured(items) {
    const seen = new Set();
    const available = (items || []).filter(item => item.backdrop_path || item.local_thumbnail);
    const pool = available.length ? available : (items || []);
    return pool.filter(item => {
      const key = `${item.media_type || 'movie'}:${item.tmdb_id || String(item.title || '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  },

  _getBackdropUrl(item) {
    if (item.backdrop_path) {
      if (item.backdrop_path.startsWith('http')) return item.backdrop_path;
      return `${this._tmdbImageBase}w1280${item.backdrop_path}`;
    }
    if (item.local_thumbnail) return DSPlixAPI.getThumbnailUrl(item.id);
    return '';
  },

  _parseGenres(genre) {
    if (!genre) return [];
    try { return JSON.parse(genre); } catch { return genre.split(',').map(g => g.trim()).filter(Boolean); }
  },

  render(item) {
    if (!item) {
      return `<section class="hero">
        <div class="hero__backdrop" style="background: linear-gradient(135deg, #1a1a2e 0%, #0a0a0f 100%);"></div>
        <div class="hero__gradient"></div>
        <div class="hero__content">
          <h1 class="hero__title">Welcome to DS PLIX</h1>
          <p class="hero__overview">Your personal media streaming platform. Add a library source in Settings to get started, then scan your media library.</p>
          <div class="hero__buttons">
            <button class="btn btn--primary" onclick="window.SettingsComponent.show()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/></svg>
              Open Settings
            </button>
          </div>
        </div>
      </section>`;
    }

    return this.renderCarousel([item]);
  },

  renderCarousel(items) {
    this._items = this.getFeatured(items);
    this._index = 0;
    if (!this._items.length) return this.render(null);
    const item = this._items[0];
    const backdrop = this._getBackdropUrl(item);
    const multiple = this._items.length > 1;
    return `<section class="hero hero--carousel" id="featured-carousel" role="region" aria-roledescription="carousel" aria-label="Featured media">
      ${backdrop ? `<img class="hero__backdrop" src="${this._escapeAttr(backdrop)}" alt="" fetchpriority="high">` : '<div class="hero__backdrop"></div>'}
      <div class="hero__gradient"></div>
      <div class="hero__content" id="featured-content">${this._renderContent(item)}</div>
      ${multiple ? `<div class="hero__navigation">
        <button class="hero__nav-button" type="button" data-featured-dir="-1" aria-label="Previous featured title">&#8249;</button>
        <span class="hero__position" id="featured-position">1 / ${this._items.length}</span>
        <button class="hero__nav-button" type="button" data-featured-dir="1" aria-label="Next featured title">&#8250;</button>
      </div>
      <div class="hero__indicators" aria-label="Choose featured title">${this._items.map((entry, index) => `
        <button class="hero__indicator${index === 0 ? ' hero__indicator--active' : ''}" type="button" data-featured-index="${index}" aria-label="Show ${this._escapeAttr(entry.title)}" aria-current="${index === 0 ? 'true' : 'false'}"></button>`).join('')}</div>
      <span class="sr-only" id="featured-announcement" aria-live="polite"></span>` : ''}
    </section>`;
  },

  _renderContent(item) {
    const genres = this._parseGenres(item.genre);
    const rating = item.rating ? item.rating.toFixed(1) : null;
    return `<div class="hero__meta">
          ${rating ? `<span class="hero__badge hero__badge--rating">★ ${rating}</span>` : ''}
          ${item.year ? `<span class="hero__badge hero__badge--year">${item.year}</span>` : ''}
          ${genres.slice(0, 3).map(g => `<span class="hero__badge hero__badge--genre">${this._escapeHtml(g)}</span>`).join('')}
        </div>
        <h1 class="hero__title">${this._escapeHtml(item.title)}</h1>
        ${item.overview ? `<p class="hero__overview">${this._escapeHtml(item.overview.substring(0, 220))}${item.overview.length > 220 ? '...' : ''}</p>` : ''}
        <div class="hero__buttons">
          <button class="btn btn--primary" type="button" data-featured-action="play">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Play
          </button>
          <button class="btn btn--secondary" type="button" data-featured-action="info">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            More Info
          </button>
        </div>`;
  },

  start() {
    this.stop();
    this._hero = document.getElementById('featured-carousel');
    if (!this._hero) return;
    this._hero.addEventListener('click', event => {
      const action = event.target.closest('[data-featured-action]');
      if (action) {
        const mediaId = this._items[this._index]?.id;
        if (action.dataset.featuredAction === 'play') window.PlayerComponent.play(mediaId);
        else window.MediaDetailComponent.show(mediaId);
        return;
      }
      const direction = event.target.closest('[data-featured-dir]');
      if (direction) this.showIndex(this._index + Number(direction.dataset.featuredDir), true);
      const indicator = event.target.closest('[data-featured-index]');
      if (indicator) this.showIndex(Number(indicator.dataset.featuredIndex), true);
    });
    this._hero.addEventListener('pointerenter', () => this._pause());
    this._hero.addEventListener('pointerleave', () => this._resume());
    this._hero.addEventListener('focusin', () => this._pause());
    this._hero.addEventListener('focusout', event => {
      if (!this._hero.contains(event.relatedTarget)) this._resume();
    });
    this._visibilityHandler = () => document.hidden ? this._pause() : this._resume();
    document.addEventListener('visibilitychange', this._visibilityHandler);
    this._resume();
  },

  showIndex(index, announce = false) {
    if (!this._hero || this._items.length < 2) return;
    this._index = (index + this._items.length) % this._items.length;
    const item = this._items[this._index];
    const backdrop = this._getBackdropUrl(item);
    const oldBackdrop = this._hero.querySelector('.hero__backdrop');
    if (oldBackdrop.tagName === 'IMG') {
      if (backdrop) oldBackdrop.src = backdrop;
      else oldBackdrop.removeAttribute('src');
    }
    const content = document.getElementById('featured-content');
    content.innerHTML = this._renderContent(item);
    this._hero.querySelectorAll('.hero__indicator').forEach((button, position) => {
      const selected = position === this._index;
      button.classList.toggle('hero__indicator--active', selected);
      button.setAttribute('aria-current', String(selected));
    });
    document.getElementById('featured-position').textContent = `${this._index + 1} / ${this._items.length}`;
    if (announce) document.getElementById('featured-announcement').textContent = `Featured: ${item.title}`;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      content.animate([{ opacity: 0.25, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 280, easing: 'ease-out' });
    }
    this._pause();
    this._resume();
  },

  _pause() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  _resume() {
    if (!this._hero || this._timer || this._items.length < 2 || document.hidden ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        this._hero.matches(':hover') || this._hero.contains(document.activeElement)) return;
    this._timer = setInterval(() => this.showIndex(this._index + 1), 7000);
  },

  stop() {
    this._pause();
    if (this._visibilityHandler) document.removeEventListener('visibilitychange', this._visibilityHandler);
    this._visibilityHandler = null;
    this._hero = null;
  },

  _escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
  _escapeAttr(str) {
    return this._escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
};
