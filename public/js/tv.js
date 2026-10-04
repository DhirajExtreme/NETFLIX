// D-pad navigation for Android TV and Fire TV WebView clients.
(() => {
  if (!new URLSearchParams(location.search).has('tv')) return;
  document.body.classList.add('tv-mode');
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
  function candidates() {
    return [...document.querySelectorAll(selector)].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
  }
  function move(direction) {
    const items = candidates();
    const current = document.activeElement;
    if (!items.includes(current)) { items[0]?.focus(); return; }
    const a = current.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, score = Infinity;
    for (const item of items) {
      if (item === current) continue;
      const b = item.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
      if (along <= 4) continue;
      const cross = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      const candidateScore = along + cross * 2;
      if (candidateScore < score) { score = candidateScore; best = item; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  document.addEventListener('keydown', event => {
    if (document.activeElement?.matches('input, textarea, select')) return;
    if (!document.getElementById('player-overlay').classList.contains('hide')) return;
    const directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (directions[event.key]) { event.preventDefault(); move(directions[event.key]); }
    if (event.key === 'Escape' || event.key === 'Backspace') {
      if (!document.getElementById('settings-panel').classList.contains('hide')) window.SettingsComponent.hide();
      else if (!document.getElementById('media-detail-modal').classList.contains('hide')) window.MediaDetailComponent.hide();
      else if (!document.getElementById('search-overlay').classList.contains('hide')) window.SearchComponent.hide();
    }
  });
  window.addEventListener('load', () => setTimeout(() => candidates()[0]?.focus(), 250));
})();
