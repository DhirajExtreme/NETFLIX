/**
 * DS PLIX — Main Application Controller
 */
window.DSPlixApp = {
  state: {
    currentView: 'home',
    recentlyAdded: [],
    recentlyPlayed: [],
    continueWatching: [],
    genres: [],
    isLoading: true,
  },

  async init() {
    console.log('[DS PLIX] Initializing...');

    // Render navbar
    NavbarComponent.render();

    // Setup carousel scrolling delegation
    CarouselComponent.setupAllScrolling();

    // Setup search events
    SearchComponent.render();

    // Listen for hash changes
    window.addEventListener('hashchange', () => this._onHashChange());

    // Initial load
    await this.loadInitialData();

    // Navigate to current hash or home
    this._onHashChange();

    console.log('[DS PLIX] Ready');
  },

  async loadInitialData() {
    this.state.isLoading = true;
    const [ra, rp, cw, genresData] = await Promise.all([
      DSPlixAPI.getRecentlyAdded(20),
      DSPlixAPI.getRecentlyPlayed(20),
      DSPlixAPI.getContinueWatching(20),
      DSPlixAPI.getGenres(),
    ]);
    this.state.recentlyAdded = ra?.items || [];
    this.state.recentlyPlayed = rp?.items || [];
    this.state.continueWatching = cw?.items || [];
    this.state.genres = genresData?.genres || [];
    this.state.isLoading = false;
  },

  _onHashChange() {
    HeroComponent.stop();
    const hash = location.hash.replace('#', '') || 'home';
    this.state.currentView = hash;
    NavbarComponent.updateActiveLink(hash);

    switch (hash) {
      case 'home': this.renderHome(); break;
      case 'movies': this.renderCategory('movie'); break;
      case 'tv': this.renderCategory('tv'); break;
      case 'recent': this.renderRecent(); break;
      default: this.renderHome();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  renderHome() {
    const main = document.getElementById('main-content');
    const { recentlyAdded, recentlyPlayed, continueWatching, genres, isLoading } = this.state;

    if (isLoading) {
      main.innerHTML = `
        ${HeroComponent.render(null)}
        <div class="content-section">
          ${CarouselComponent.renderSkeletonRow('Recently Added')}
          ${CarouselComponent.renderSkeletonRow('Continue Watching')}
        </div>`;
      return;
    }

    // Group items by genre for genre rows
    const genreRows = this._buildGenreRows(recentlyAdded);

    main.innerHTML = `
      ${HeroComponent.renderCarousel(recentlyAdded)}
      <div class="content-section">
        ${continueWatching.length ? CarouselComponent.renderRow('Continue Watching', continueWatching) : ''}
        ${CarouselComponent.renderRow('Recently Added', recentlyAdded)}
        ${recentlyPlayed.length ? CarouselComponent.renderRow('Recently Played', recentlyPlayed) : ''}
        ${genreRows}
      </div>`;
    HeroComponent.start();
  },

  _buildGenreRows(items) {
    if (!items.length) return '';
    const genreMap = {};
    items.forEach(item => {
      let genres = [];
      try { genres = JSON.parse(item.genre || '[]'); } catch { genres = (item.genre || '').split(',').map(g => g.trim()).filter(Boolean); }
      genres.forEach(g => {
        if (!genreMap[g]) genreMap[g] = [];
        if (genreMap[g].length < 20) genreMap[g].push(item);
      });
    });
    return Object.entries(genreMap)
      .filter(([, items]) => items.length >= 3)
      .slice(0, 5)
      .map(([genre, items]) => CarouselComponent.renderRow(genre, items))
      .join('');
  },

  async renderCategory(type) {
    const main = document.getElementById('main-content');
    const label = type === 'movie' ? 'Movies' : 'TV Shows';

    // Initial render with sort bar + loading
    SortComponent._state.type = type;
    main.innerHTML = `
      <div style="padding-top: calc(var(--navbar-height) + 24px);">
        <div class="content-section">
          <h1 style="font-family:var(--font-display);font-size:32px;font-weight:800;margin-bottom:8px;">${label}</h1>
          ${SortComponent.render(this.state.genres)}
          <div class="media-grid" id="category-grid">
            ${Array(12).fill(MediaCardComponent.renderSkeleton()).join('')}
          </div>
        </div>
      </div>`;

    SortComponent.setupEvents();
    SortComponent.onChange((state) => this._loadCategoryGrid(state));

    // Load data
    await this._loadCategoryGrid(SortComponent.getState());
  },

  async _loadCategoryGrid(filterState) {
    const grid = document.getElementById('category-grid');
    if (!grid) return;
    grid.innerHTML = Array(8).fill(MediaCardComponent.renderSkeleton()).join('');

    const data = await DSPlixAPI.getMedia({
      sort: filterState.sort,
      order: filterState.order,
      genre: filterState.genre,
      type: filterState.type,
      limit: 100,
    });

    const items = data?.items || [];
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon">🎬</div>
        <div class="empty-state__title">No media found</div>
        <div class="empty-state__desc">Try adjusting your filters or add media in Settings.</div>
      </div>`;
      return;
    }
    grid.innerHTML = items.map(m => MediaCardComponent.render(m)).join('');

    // Re-render sort bar to update active states
    const sortBarParent = document.getElementById('sort-bar')?.parentElement;
    if (sortBarParent) {
      const existingBar = document.getElementById('sort-bar');
      const newBar = document.createElement('div');
      newBar.innerHTML = SortComponent.render(this.state.genres);
      existingBar.replaceWith(newBar.firstElementChild);
      SortComponent.setupEvents();
    }
  },

  async renderRecent() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div style="padding-top: calc(var(--navbar-height) + 24px);">
        <div class="content-section">
          <h1 style="font-family:var(--font-display);font-size:32px;font-weight:800;margin-bottom:20px;">Recently Added</h1>
          <div class="media-grid" id="recent-grid">
            ${Array(12).fill(MediaCardComponent.renderSkeleton()).join('')}
          </div>
        </div>
      </div>`;

    const data = await DSPlixAPI.getRecentlyAdded(60);
    const items = data?.items || [];
    const grid = document.getElementById('recent-grid');
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon">📂</div>
        <div class="empty-state__title">No media yet</div>
        <div class="empty-state__desc">Add a library source in Settings and scan your media.</div>
      </div>`;
      return;
    }
    grid.innerHTML = items.map(m => MediaCardComponent.render(m)).join('');
  },

  showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<div class="toast__message">${message}</div><div class="toast__progress"></div>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },
};

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', () => {
  window.DSPlixApp.init();
});
