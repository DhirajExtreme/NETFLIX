/**
 * Carousel Component — Netflix-style horizontal scroll rows
 */
window.CarouselComponent = {
  _counter: 0,

  renderRow(title, items) {
    const id = `carousel-${++this._counter}`;
    if (!items || !items.length) {
      return `<div class="row">
        <div class="row__header"><h2 class="row__title">${title}</h2></div>
        <div class="empty-state" style="padding:24px 0;">
          <p style="color:var(--text-muted);font-size:14px;">No items to display</p>
        </div>
      </div>`;
    }

    const cards = items.map(m => window.MediaCardComponent.render(m)).join('');

    return `<div class="row">
      <div class="row__header"><h2 class="row__title">${title}</h2></div>
      <div class="carousel-wrapper">
        <button class="carousel__arrow carousel__arrow--left" data-carousel="${id}" data-dir="-1" aria-label="Scroll left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="carousel" id="${id}">${cards}</div>
        <button class="carousel__arrow carousel__arrow--right" data-carousel="${id}" data-dir="1" aria-label="Scroll right">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>`;
  },

  renderSkeletonRow(title, count = 8) {
    const id = `carousel-skel-${++this._counter}`;
    const cards = Array(count).fill(window.MediaCardComponent.renderSkeleton()).join('');
    return `<div class="row">
      <div class="row__header"><h2 class="row__title">${title}</h2></div>
      <div class="carousel-wrapper"><div class="carousel" id="${id}">${cards}</div></div>
    </div>`;
  },

  setupAllScrolling() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.carousel__arrow');
      if (!btn) return;
      const carouselId = btn.dataset.carousel;
      const dir = parseInt(btn.dataset.dir, 10);
      const container = document.getElementById(carouselId);
      if (container) {
        const scrollAmt = container.clientWidth * 0.75;
        container.scrollBy({ left: dir * scrollAmt, behavior: 'smooth' });
      }
    });
  },
};
