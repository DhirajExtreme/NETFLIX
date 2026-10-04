/**
 * Sort / Filter Bar Component
 */
window.SortComponent = {
  _callback: null,
  _state: { sort: 'added_at', order: 'desc', genre: '', type: 'all' },

  render(genres = []) {
    const s = this._state;
    const sortOptions = [
      { key: 'added_at', label: 'Date Added' },
      { key: 'title', label: 'Title' },
      { key: 'year', label: 'Year' },
      { key: 'rating', label: 'Rating' },
      { key: 'duration', label: 'Duration' },
    ];
    const typeOptions = [
      { key: 'all', label: 'All' },
      { key: 'movie', label: 'Movies' },
      { key: 'tv', label: 'TV' },
    ];

    return `<div class="sort-bar" id="sort-bar">
      <span class="sort-bar__label">Sort</span>
      <div class="sort-bar__group">
        ${sortOptions.map(o => `<button class="sort-bar__pill ${s.sort === o.key ? 'sort-bar__pill--active' : ''}" data-sort="${o.key}">${o.label}</button>`).join('')}
      </div>
      <div class="sort-bar__divider"></div>
      <button class="sort-bar__pill" id="sort-order-btn" data-order="${s.order}">
        ${s.order === 'asc' ? '↑ Asc' : '↓ Desc'}
      </button>
      <div class="sort-bar__divider"></div>
      <span class="sort-bar__label">Type</span>
      <div class="sort-bar__group">
        ${typeOptions.map(o => `<button class="sort-bar__pill ${s.type === o.key ? 'sort-bar__pill--active' : ''}" data-type="${o.key}">${o.label}</button>`).join('')}
      </div>
      ${genres.length ? `
        <div class="sort-bar__divider"></div>
        <span class="sort-bar__label">Genre</span>
        <select class="sort-bar__select" id="sort-genre-select">
          <option value="">All Genres</option>
          ${genres.map(g => `<option value="${g}" ${s.genre === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>` : ''}
    </div>`;
  },

  setupEvents() {
    const bar = document.getElementById('sort-bar');
    if (!bar) return;

    bar.addEventListener('click', (e) => {
      const pill = e.target.closest('[data-sort]');
      if (pill) {
        this._state.sort = pill.dataset.sort;
        this._fireChange();
        return;
      }
      const typeBtn = e.target.closest('[data-type]');
      if (typeBtn) {
        this._state.type = typeBtn.dataset.type;
        this._fireChange();
        return;
      }
      const orderBtn = e.target.closest('#sort-order-btn');
      if (orderBtn) {
        this._state.order = this._state.order === 'asc' ? 'desc' : 'asc';
        this._fireChange();
      }
    });

    const genreSelect = document.getElementById('sort-genre-select');
    if (genreSelect) {
      genreSelect.addEventListener('change', (e) => {
        this._state.genre = e.target.value;
        this._fireChange();
      });
    }
  },

  onChange(callback) { this._callback = callback; },

  getState() { return { ...this._state }; },

  _fireChange() {
    if (this._callback) this._callback(this._state);
  },
};
