/**
 * Navbar Component
 */
window.NavbarComponent = {
  render() {
    const nav = document.getElementById('navbar');
    nav.className = 'navbar';
    nav.innerHTML = `
      <div class="navbar__left">
        <a href="#home" class="navbar__logo">
          <span class="navbar__logo-icon">🎬</span> DS PLIX
        </a>
        <div class="navbar__links">
          <a href="#home" class="navbar__link navbar__link--active" data-nav="home">Home</a>
          <a href="#movies" class="navbar__link" data-nav="movies">Movies</a>
          <a href="#tv" class="navbar__link" data-nav="tv">TV Shows</a>
          <a href="#recent" class="navbar__link" data-nav="recent">Recently Added</a>
        </div>
      </div>
      <div class="navbar__right">
        <button class="navbar__private-btn" id="nav-private-btn" type="button">Private play</button>
        <button class="navbar__icon-btn" id="nav-search-btn" aria-label="Search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button class="navbar__icon-btn" id="nav-settings-btn" aria-label="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>`;
    this.setupEvents();
  },

  setupEvents() {
    document.getElementById('nav-search-btn').addEventListener('click', () => window.SearchComponent.show());
    document.getElementById('nav-settings-btn').addEventListener('click', () => window.SettingsComponent.show());
    document.getElementById('nav-private-btn').addEventListener('click', () => {
      window.SettingsComponent.show();
      window.SettingsComponent._showLocalLocations();
    });
    window.addEventListener('scroll', () => this.handleScroll(), { passive: true });
  },

  updateActiveLink(hash) {
    const view = hash.replace('#', '') || 'home';
    document.querySelectorAll('.navbar__link').forEach(el => {
      el.classList.toggle('navbar__link--active', el.dataset.nav === view);
    });
  },

  handleScroll() {
    const nav = document.getElementById('navbar');
    if (nav) nav.classList.toggle('navbar--scrolled', window.scrollY > 50);
  },
};
