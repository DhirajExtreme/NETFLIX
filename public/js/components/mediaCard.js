/**
 * Media Card Component
 */
window.MediaCardComponent = {
  _tmdbImageBase: 'https://image.tmdb.org/t/p/',

  _parseGenres(genre) {
    if (!genre) return [];
    try { return JSON.parse(genre); } catch { return genre.split(',').map(g => g.trim()).filter(Boolean); }
  },

  _getPosterUrl(media) {
    if (media.poster_path) {
      if (media.poster_path.startsWith('http')) return media.poster_path;
      return `${this._tmdbImageBase}w342${media.poster_path}`;
    }
    if (media.local_thumbnail) return DSPlixAPI.getThumbnailUrl(media.id);
    return '';
  },

  render(media) {
    const poster = this._getPosterUrl(media);
    const genres = this._parseGenres(media.genre);
    const rating = media.rating ? media.rating.toFixed(1) : null;
    const progress = media.watch_progress && media.watch_duration
      ? Math.min((media.watch_progress / media.watch_duration) * 100, 100)
      : 0;

    const imgHtml = poster
      ? `<img class="media-card__poster" src="${poster}" alt="${this._esc(media.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="media-card__placeholder" style="display:none;">${this._esc(media.title)}</div>`
      : `<div class="media-card__placeholder">${this._esc(media.title)}</div>`;

    return `<div class="media-card" data-media-id="${media.id}" onclick="window.MediaDetailComponent.show(${media.id})">
      ${imgHtml}
      <div class="media-card__overlay">
        <div class="media-card__title">${this._esc(media.title)}</div>
        <div class="media-card__meta">
          ${media.year ? `<span>${media.year}</span>` : ''}
          ${rating ? `<span class="media-card__rating">★ ${rating}</span>` : ''}
        </div>
        <div class="media-card__genres">
          ${genres.slice(0, 2).map(g => `<span class="media-card__genre-tag">${g}</span>`).join('')}
        </div>
      </div>
      ${progress > 0 ? `<div class="media-card__progress-bar"><div class="media-card__progress-fill" style="width:${progress}%"></div></div>` : ''}
    </div>`;
  },

  renderSkeleton() {
    return '<div class="media-card media-card--skeleton"></div>';
  },

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};
