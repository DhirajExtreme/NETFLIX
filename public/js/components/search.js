/**
 * Search Overlay Component
 */
window.SearchComponent = {
  _debounceTimer: null,

  render() {
    // Already in index.html — just wire up events
    this._setupEvents();
  },

  _setupEvents() {
    const input = document.getElementById('search-input');
    const closeBtn = document.getElementById('search-close-btn');

    input.addEventListener('input', (e) => this._handleInput(e.target.value));
    closeBtn.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', (e) => {
      const overlay = document.getElementById('search-overlay');
      if (e.key === 'Escape' && !overlay.classList.contains('hide')) {
        this.hide();
      }
    });
  },

  show() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.remove('hide');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('search-input').focus(), 100);
  },

  hide() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.add('hide');
    document.body.style.overflow = '';
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
  },

  _handleInput(query) {
    clearTimeout(this._debounceTimer);
    if (!query || query.length < 2) {
      document.getElementById('search-results').innerHTML = '';
      return;
    }
    this._debounceTimer = setTimeout(async () => {
      const result = await DSPlixAPI.searchMedia(query);
      this._renderResults(result ? result.items : []);
    }, 300);
  },

  _renderResults(items) {
    const container = document.getElementById('search-results');
    if (!items || !items.length) {
      container.innerHTML = '<div class="search-overlay__empty">No results found</div>';
      return;
    }
    container.innerHTML = items.map(m => window.MediaCardComponent.render(m)).join('');
  },
};
