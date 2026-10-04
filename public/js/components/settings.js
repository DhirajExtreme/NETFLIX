/**
 * Settings Panel Component
 */
window.SettingsComponent = {
  _visible: false,
  _scanPollTimer: null,
  _localPollTimer: null,

  show() {
    if (this._visible) return;
    this._visible = true;
    this._renderContent();
    document.getElementById('settings-panel').classList.remove('hide');
    document.getElementById('settings-backdrop').classList.remove('hide');
    document.body.style.overflow = 'hidden';
    this.loadSettings();
  },

  hide() {
    this._visible = false;
    document.getElementById('settings-panel').classList.add('hide');
    document.getElementById('settings-backdrop').classList.add('hide');
    document.body.style.overflow = '';
    if (this._scanPollTimer) { clearInterval(this._scanPollTimer); this._scanPollTimer = null; }
    if (this._localPollTimer) { clearInterval(this._localPollTimer); this._localPollTimer = null; }
  },

  _renderContent() {
    document.getElementById('settings-content').innerHTML = `
      <div class="settings__header">
        <h2 class="settings__title">Settings</h2>
        <button class="settings__close-btn" id="settings-close-btn">&times;</button>
      </div>

      <!-- TMDB API Key -->
      <div class="settings__section">
        <h3 class="settings__section-title">TMDB API Key</h3>
        <div class="settings__input-group">
          <div class="settings__input--password-wrap">
            <input type="password" id="settings-tmdb-key" class="settings__input" placeholder="Enter your TMDB API key...">
            <button class="settings__toggle-btn" id="settings-tmdb-toggle">Show</button>
          </div>
        </div>
        <button class="settings__btn settings__btn--primary" id="settings-save-key" style="margin-top:8px;">Save API Key</button>
      </div>

      <div class="settings__section">
        <h3 class="settings__section-title">Online subtitles</h3>
        <p class="settings__hint">Use your OpenSubtitles.com account to search and download captions.</p>
        <input id="settings-os-key" class="settings__input" type="password" placeholder="OpenSubtitles API key" autocomplete="off">
        <input id="settings-os-user" class="settings__input" type="text" placeholder="Username" autocomplete="off">
        <input id="settings-os-password" class="settings__input" type="password" placeholder="Password" autocomplete="new-password">
        <button class="settings__btn settings__btn--primary" id="settings-save-os" type="button">Save subtitle account</button>
      </div>

      <!-- Library Sources -->
      <div class="settings__section">
        <h3 class="settings__section-title">Library Sources</h3>
        <div class="settings__source-list" id="settings-source-list">
          <p style="color:var(--text-muted);font-size:13px;">Loading...</p>
        </div>
        <div id="settings-folder-browser" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,0.06);border-radius:6px;"></div>
        <div class="settings__local-intro">
          <button class="settings__btn settings__btn--secondary" id="settings-local-btn">Browse laptop files</button>
          <span>Choose a folder or individual videos already on this computer.</span>
        </div>
        <div class="settings__local-browser" id="settings-local-browser" hidden></div>
        <div style="margin-top:12px;">
          <label class="settings__label">Add New Source</label>
          <div class="settings__add-form">
            <input type="text" id="settings-src-name" class="settings__input" placeholder="Name" style="flex:1;">
            <input type="text" id="settings-src-path" class="settings__input" placeholder="E:\\Movies or ftp://admin@192.168.1.1/" style="flex:2;">
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <select id="settings-src-type" class="settings__input" style="flex:1;">
              <option value="local">Local / Mounted</option>
              <option value="smb">SMB Share</option>
              <option value="ftp">FTP Server</option>
            </select>
            <button class="settings__btn settings__btn--secondary" id="settings-netscan-btn">🔍 Scan Network</button>
            <button class="settings__btn settings__btn--primary" id="settings-add-src">Add Source</button>
          </div>
          <div class="settings__ftp-credentials" id="settings-ftp-credentials" hidden>
            <label class="settings__label" for="settings-src-password">FTP password</label>
            <input type="password" id="settings-src-password" class="settings__input" placeholder="Password for the FTP account" autocomplete="new-password">
            <p class="settings__hint">Adding an FTP server opens its folder picker. Only folders you select will be indexed.</p>
          </div>
          <div class="settings__netscan-progress" id="settings-netscan-progress" style="display:none;margin-top:12px;text-align:center;">
            <div class="spinner" style="display:inline-block;width:20px;height:20px;border:3px solid rgba(255,255,255,0.3);border-radius:50%;border-top-color:#e50914;animation:spin 1s ease-in-out infinite;"></div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">Scanning local subnet & shares...</div>
          </div>
          <div class="settings__netscan-results" id="settings-netscan-results" style="margin-top:12px;display:none;max-height:200px;overflow-y:auto;background:rgba(255,255,255,0.05);padding:8px;border-radius:4px;">
          </div>
        </div>
      </div>

      <!-- Add Stream Link -->
      <div class="settings__section">
        <h3 class="settings__section-title">Add Streaming Link</h3>
        <div class="settings__add-form">
          <input type="text" id="settings-stream-url" class="settings__input" placeholder="URL (http://...)" style="flex:2;">
          <input type="text" id="settings-stream-title" class="settings__input" placeholder="Title" style="flex:1;">
        </div>
        <button class="settings__btn settings__btn--secondary" id="settings-add-stream" style="margin-top:8px;width:100%;">Add Stream</button>
      </div>

      <!-- Library Actions -->
      <div class="settings__section">
        <h3 class="settings__section-title">Library Actions</h3>
        <button class="settings__btn settings__btn--primary settings__btn--full" id="settings-scan-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Scan All Libraries
        </button>
        <p style="color:var(--text-muted);font-size:12px;margin:8px 0;">Only enabled folders are scanned. The next full scan removes files outside them from the library.</p>
        <div class="settings__progress" id="settings-scan-progress" style="display:none;">
          <div class="settings__progress-fill" id="settings-scan-progress-fill" style="width:0%"></div>
        </div>
        <div class="settings__status" id="settings-scan-status"></div>
      </div>



      <!-- System Info -->
      <div class="settings__section">
        <h3 class="settings__section-title">Android TV & Fire TV</h3>
        <p class="settings__hint">Keep DS PLIX running on this laptop. Connect the TV to the same network, then enter one of these addresses in the TV app:</p>
        <div id="settings-tv-urls" class="settings__system-info">Loading laptop address…</div>
      </div>
      <div class="settings__section">
        <h3 class="settings__section-title">System Info</h3>
        <div class="settings__system-info" id="settings-system-info">
          <span style="color:var(--text-muted);">Loading...</span>
        </div>
      </div>`;

    this._setupSettingsEvents();
  },

  _setupSettingsEvents() {
    document.getElementById('settings-close-btn').addEventListener('click', () => this.hide());
    document.getElementById('settings-backdrop').addEventListener('click', () => this.hide());

    // TMDB key toggle
    document.getElementById('settings-tmdb-toggle').addEventListener('click', () => {
      const inp = document.getElementById('settings-tmdb-key');
      const btn = document.getElementById('settings-tmdb-toggle');
      if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
      else { inp.type = 'password'; btn.textContent = 'Show'; }
    });

    // Save key
    document.getElementById('settings-save-key').addEventListener('click', async () => {
      const key = document.getElementById('settings-tmdb-key').value.trim();
      if (!key) return;
      const saved = await DSPlixAPI.updateSettings({ tmdb_api_key: key });
      window.DSPlixApp.showNotification(saved ? 'API key saved' : 'Could not save API key', saved ? 'success' : 'error');
    });
    document.getElementById('settings-save-os').addEventListener('click', async () => {
      const values = {
        opensubtitles_api_key: document.getElementById('settings-os-key').value.trim(),
        opensubtitles_username: document.getElementById('settings-os-user').value.trim(),
        opensubtitles_password: document.getElementById('settings-os-password').value,
      };
      const update = Object.fromEntries(Object.entries(values).filter(([, value]) => value && !value.startsWith('****')));
      const result = await DSPlixAPI.updateSettings(update);
      window.DSPlixApp.showNotification(result ? 'Subtitle account saved' : 'Enter account details first', result ? 'success' : 'error');
    });

    // Add source
    const sourceType = document.getElementById('settings-src-type');
    const ftpCredentials = document.getElementById('settings-ftp-credentials');
    sourceType.addEventListener('change', () => {
      ftpCredentials.hidden = sourceType.value !== 'ftp';
    });
    document.getElementById('settings-add-src').addEventListener('click', async () => {
      const name = document.getElementById('settings-src-name').value.trim();
      const path = document.getElementById('settings-src-path').value.trim();
      const type = sourceType.value;
      if (!path || (type !== 'ftp' && !name)) {
        window.DSPlixApp.showNotification(type === 'ftp' ? 'FTP address is required' : 'Name and path are required', 'error');
        return;
      }
      const password = document.getElementById('settings-src-password').value;
      const res = await DSPlixAPI.addLibrarySource({ name, path, source_type: type, ...(type === 'ftp' && password ? { password } : {}) });
      if (res?.source) {
        const rootFtp = type === 'ftp' && !res.source.enabled;
        window.DSPlixApp.showNotification(rootFtp ? 'FTP server connected. Choose folders to index.' : 'Source added', 'success');
        document.getElementById('settings-src-name').value = '';
        document.getElementById('settings-src-path').value = '';
        document.getElementById('settings-src-password').value = '';
        await this._loadSources();
        if (rootFtp) this._browseSourceFolder(res.source.id, '', name || new URL(path).hostname);
      } else {
        window.DSPlixApp.showNotification(res?.error || 'Could not add source', 'error');
      }
    });

    // Add stream link
    document.getElementById('settings-add-stream').addEventListener('click', async () => {
      const url = document.getElementById('settings-stream-url').value.trim();
      const title = document.getElementById('settings-stream-title').value.trim();
      if (!url || !title) { window.DSPlixApp.showNotification('URL and title required', 'error'); return; }
      const res = await DSPlixAPI.addStreamLink({ url, title });
      if (res) {
        window.DSPlixApp.showNotification('Stream link added', 'success');
        document.getElementById('settings-stream-url').value = '';
        document.getElementById('settings-stream-title').value = '';
      }
    });

    // Scan
    document.getElementById('settings-scan-btn').addEventListener('click', () => this._handleScan());

    // Network Scan
    document.getElementById('settings-netscan-btn').addEventListener('click', () => this._handleNetworkScan());
    document.getElementById('settings-local-btn').addEventListener('click', () => this._showLocalLocations());
  },

  async _showLocalLocations() {
    const browser = document.getElementById('settings-local-browser');
    browser.hidden = false;
    browser.textContent = 'Loading laptop locations…';
    const data = await DSPlixAPI.getLocalLocations();
    if (!data) { browser.textContent = 'Open this app on the laptop to browse its files.'; return; }
    browser.innerHTML = `
      <div class="settings__local-header"><strong>Laptop locations</strong><button class="settings__btn settings__btn--secondary settings__local-close" type="button">Close</button></div>
      <div class="settings__local-list">${data.locations.map(location => `
        <button class="settings__local-row settings__local-location" type="button" data-path="${encodeURIComponent(location.path)}">📁 ${this._esc(location.name)} <small>${this._esc(location.path)}</small></button>`).join('')}</div>`;
    browser.querySelector('.settings__local-close').addEventListener('click', () => { browser.hidden = true; });
    browser.querySelectorAll('.settings__local-location').forEach(button => {
      button.addEventListener('click', () => this._browseLocalFolder(decodeURIComponent(button.dataset.path)));
    });
  },

  async _browseLocalFolder(folderPath) {
    const browser = document.getElementById('settings-local-browser');
    browser.hidden = false;
    browser.textContent = 'Opening folder…';
    const data = await DSPlixAPI.browseLocalFolder(folderPath);
    if (!data) {
      browser.innerHTML = '<p>Could not open this folder. Check its permissions.</p><button class="settings__btn settings__btn--secondary settings__local-back" type="button">Locations</button>';
      browser.querySelector('.settings__local-back').addEventListener('click', () => this._showLocalLocations());
      return;
    }
    browser.innerHTML = `
      <div class="settings__local-header"><button class="settings__btn settings__btn--secondary settings__local-locations" type="button">Locations</button>
        ${data.parent ? '<button class="settings__btn settings__btn--secondary settings__local-up" type="button">← Up</button>' : ''}</div>
      <div class="settings__local-path" title="${this._esc(data.path)}">${this._esc(data.path)}</div>
      ${data.parent ? '<button class="settings__btn settings__btn--primary settings__local-add-folder" type="button">Add this folder</button>' : ''}
      <div class="settings__local-list">
        ${data.files.length ? '<div class="settings__local-list-title">Videos in this folder</div>' : ''}
        ${data.files.map(file => `<div class="settings__local-row"><input type="checkbox" class="settings__local-file" value="${encodeURIComponent(file.path)}" aria-label="Add ${this._esc(file.name)} to library"> <span>${this._esc(file.name)}</span><button class="settings__btn settings__btn--secondary settings__private-file" data-path="${encodeURIComponent(file.path)}" type="button">Play privately</button></div>`).join('')}
        ${data.directories.length ? '<div class="settings__local-list-title">Folders</div>' : ''}
        ${data.directories.map(dir => `<button class="settings__local-row settings__local-directory" type="button" data-path="${encodeURIComponent(dir.path)}">📁 ${this._esc(dir.name)}</button>`).join('')}
        ${!data.directories.length && !data.files.length ? '<p class="settings__local-empty">No folders or supported videos here.</p>' : ''}
      </div>
      ${data.files.length ? '<button class="settings__btn settings__btn--primary settings__local-add-files" type="button">Add selected videos</button>' : ''}`;
    browser.querySelector('.settings__local-locations').addEventListener('click', () => this._showLocalLocations());
    browser.querySelector('.settings__local-up')?.addEventListener('click', () => this._browseLocalFolder(data.parent));
    browser.querySelectorAll('.settings__local-directory').forEach(button => {
      button.addEventListener('click', () => this._browseLocalFolder(decodeURIComponent(button.dataset.path)));
    });
    browser.querySelectorAll('.settings__private-file').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const session = await DSPlixAPI.openPrivate(decodeURIComponent(button.dataset.path));
        button.disabled = false;
        if (!session || !session.token) { window.DSPlixApp.showNotification('Could not open this file privately', 'error'); return; }
        this.hide();
        window.PlayerComponent.playPrivate(session);
      });
    });
    browser.querySelector('.settings__local-add-folder')?.addEventListener('click', () => {
      this._addLocalItems([{ path: data.path, kind: 'folder' }]);
    });
    browser.querySelector('.settings__local-add-files')?.addEventListener('click', () => {
      const items = [...browser.querySelectorAll('.settings__local-file:checked')].map(input => ({
        path: decodeURIComponent(input.value), kind: 'file',
      }));
      if (!items.length) { window.DSPlixApp.showNotification('Select at least one video', 'info'); return; }
      this._addLocalItems(items);
    });
  },

  async _addLocalItems(items) {
    const browser = document.getElementById('settings-local-browser');
    browser.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const result = await DSPlixAPI.addLocalItems(items);
    if (!result) {
      browser.querySelectorAll('button').forEach(button => { button.disabled = false; });
      window.DSPlixApp.showNotification('Could not add the selected files', 'error');
      return;
    }
    browser.hidden = true;
    await this._loadSources();
    if (!result.ids.length) {
      window.DSPlixApp.showNotification('Already in your library sources', 'info');
      return;
    }
    window.DSPlixApp.showNotification(result.indexing ? 'Adding laptop media to your library…' : 'Sources added. Scan All Libraries to index them.', 'success');
    if (result.indexing) {
      setTimeout(() => window.DSPlixApp.loadInitialData(), 1200);
      if (this._localPollTimer) clearInterval(this._localPollTimer);
      this._localPollTimer = setInterval(async () => {
        const status = await DSPlixAPI.getScanStatus();
        if (status && !status.scanning) {
          clearInterval(this._localPollTimer);
          this._localPollTimer = null;
          window.DSPlixApp.loadInitialData();
          window.DSPlixApp.showNotification(status.errors?.length ? 'Laptop indexing finished with errors' : 'Laptop media is ready', status.errors?.length ? 'error' : 'success');
        }
      }, 1500);
    }
  },

  async loadSettings() {
    // Load TMDB key
    const settings = await DSPlixAPI.getSettings();
    if (settings && settings.tmdb_api_key) {
      document.getElementById('settings-tmdb-key').placeholder = `Current: ${settings.tmdb_api_key}`;
    }
    if (settings?.opensubtitles_api_key) document.getElementById('settings-os-key').placeholder = `Current: ${settings.opensubtitles_api_key}`;
    if (settings?.opensubtitles_username) document.getElementById('settings-os-user').value = settings.opensubtitles_username;
    if (settings?.opensubtitles_password) document.getElementById('settings-os-password').placeholder = 'Password saved';
    this._loadSources();
    this._loadSystemInfo();
  },

  async _loadSources() {
    const data = await DSPlixAPI.getLibrarySources();
    const container = document.getElementById('settings-source-list');
    if (!data || !data.sources || !data.sources.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No library sources configured</p>';
      return;
    }
    container.innerHTML = data.sources.map(src => `
      <div class="settings__source-item">
        <div class="settings__source-item-info">
          <div class="settings__source-name">${this._esc(src.name)}</div>
          <div class="settings__source-path">${this._esc(src.path)} • ${src.source_type} • ${src.enabled ? 'Enabled' : 'Paused'}</div>
        </div>
        <label style="font-size:11px;white-space:nowrap;"><input type="checkbox" class="settings__source-toggle" data-source-id="${src.id}" ${src.enabled ? 'checked' : ''}> Scan</label>
        ${src.source_type === 'ftp' ? `<button class="settings__btn settings__btn--secondary settings__source-browse" data-source-id="${src.id}" data-source-name="${this._esc(src.name)}" style="padding:5px 8px;font-size:11px;">Choose folders</button>` : ''}
        <button class="settings__source-del" data-source-id="${src.id}" title="Remove">&times;</button>
      </div>`).join('');

    container.querySelectorAll('.settings__source-toggle').forEach(toggle => {
      toggle.addEventListener('change', async () => {
        const result = await DSPlixAPI.updateLibrarySource(toggle.dataset.sourceId, { enabled: toggle.checked });
        if (!result) window.DSPlixApp.showNotification('Could not update source', 'error');
        this._loadSources();
      });
    });
    container.querySelectorAll('.settings__source-browse').forEach(button => {
      button.addEventListener('click', () => this._browseSourceFolder(button.dataset.sourceId, '', button.dataset.sourceName));
    });

    container.querySelectorAll('.settings__source-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await DSPlixAPI.deleteLibrarySource(btn.dataset.sourceId);
        window.DSPlixApp.showNotification('Source removed. Scan to update the library.', 'info');
        this._loadSources();
      });
    });
  },

  async _browseSourceFolder(sourceId, relativePath, sourceName) {
    const browser = document.getElementById('settings-folder-browser');
    browser.style.display = 'block';
    browser.textContent = 'Loading folders...';
    const data = await DSPlixAPI.browseSourceFolder(sourceId, relativePath);
    if (!data) {
      browser.textContent = 'Could not open this FTP folder. Check that the server is reachable.';
      return;
    }
    const parent = relativePath.split('/').filter(Boolean).slice(0, -1).join('/');
    browser.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
        <button id="folder-up" class="settings__btn settings__btn--secondary" style="padding:4px 7px;">${relativePath ? '← Up' : 'Close'}</button>
        <strong style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this._esc(sourceName)} / ${this._esc(relativePath || '')}</strong>
        ${relativePath ? '<button id="folder-select" class="settings__btn settings__btn--primary" style="padding:4px 7px;">Use this folder</button>' : ''}
      </div>
      ${data.directories.length ? data.directories.map(dir => `<button class="settings__folder-open" data-path="${encodeURIComponent(dir.path)}" style="display:block;width:100%;text-align:left;background:transparent;border:0;color:inherit;padding:7px;cursor:pointer;">📁 ${this._esc(dir.name)}</button>`).join('') : '<p style="font-size:12px;color:var(--text-muted);">No subfolders here.</p>'}`;
    browser.querySelector('#folder-up').addEventListener('click', () => {
      if (!relativePath) browser.style.display = 'none';
      else this._browseSourceFolder(sourceId, parent, sourceName);
    });
    browser.querySelectorAll('.settings__folder-open').forEach(button => {
      button.addEventListener('click', () => this._browseSourceFolder(sourceId, decodeURIComponent(button.dataset.path), sourceName));
    });
    const select = browser.querySelector('#folder-select');
    if (select) select.addEventListener('click', async () => {
      select.disabled = true;
      const result = await DSPlixAPI.addSourceFolder(sourceId, relativePath);
      if (!result) {
        select.disabled = false;
        window.DSPlixApp.showNotification('Could not add this folder', 'error');
        return;
      }
      browser.style.display = 'none';
      await this._loadSources();
      window.DSPlixApp.showNotification('Folder selected. Scan All Libraries to refresh.', 'success');
    });
  },

  async _loadSystemInfo() {
    const info = await DSPlixAPI.getSystemInfo();
    const container = document.getElementById('settings-system-info');
    const tvUrls = document.getElementById('settings-tv-urls');
    if (!info) { container.innerHTML = '<span style="color:var(--text-muted);">Could not load system info</span>'; return; }
    tvUrls.textContent = info.tvUrls?.length ? info.tvUrls.join('   ·   ') : 'No active LAN address found';
    container.innerHTML = `
      <span class="settings__system-label">FFmpeg</span>
      <span class="${info.ffmpegInstalled ? 'settings__system-ok' : 'settings__system-err'}">${info.ffmpegInstalled ? '✓ Installed' : '✗ Not found'}</span>
      <span class="settings__system-label">FFprobe</span>
      <span class="${info.ffprobeInstalled ? 'settings__system-ok' : 'settings__system-err'}">${info.ffprobeInstalled ? '✓ Installed' : '✗ Not found'}</span>
      <span class="settings__system-label">Platform</span><span>${info.platform || 'Unknown'}</span>
      <span class="settings__system-label">Node.js</span><span>${info.nodeVersion || 'Unknown'}</span>`;
  },

  async _handleScan() {
    const btn = document.getElementById('settings-scan-btn');
    btn.disabled = true;
    btn.innerHTML = 'Scanning...';
    document.getElementById('settings-scan-progress').style.display = 'block';

    const started = await DSPlixAPI.triggerScan();
    if (!started) {
      btn.disabled = false;
      document.getElementById('settings-scan-progress').style.display = 'none';
      window.DSPlixApp.showNotification('Could not start library scan', 'error');
      return;
    }

    this._scanPollTimer = setInterval(async () => {
      const status = await DSPlixAPI.getScanStatus();
      if (!status) return;
      const fill = document.getElementById('settings-scan-progress-fill');
      const statusEl = document.getElementById('settings-scan-status');

      if (status.total > 0) {
        const pct = Math.round((status.progress / status.total) * 100);
        fill.style.width = pct + '%';
        statusEl.textContent = `Processing ${status.progress}/${status.total}${status.current ? ': ' + status.current : ''}`;
      }
      if (!status.scanning) {
        clearInterval(this._scanPollTimer);
        this._scanPollTimer = null;
        btn.disabled = false;
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Scan All Libraries`;
        fill.style.width = '100%';
        const errors = status.errors || [];
        statusEl.textContent = errors.length ? `Scan finished with ${errors.length} error(s): ${errors[0]}` : `Scan complete! ${status.progress} file(s) processed.`;
        window.DSPlixApp.showNotification(errors.length ? 'Library scan finished with errors' : 'Library scan complete', errors.length ? 'error' : 'success');
        setTimeout(() => {
          document.getElementById('settings-scan-progress').style.display = 'none';
          window.DSPlixApp.loadInitialData();
        }, 1500);
      }
    }, 1500);
  },

  async _handleNetworkScan() {
    const btn = document.getElementById('settings-netscan-btn');
    const prog = document.getElementById('settings-netscan-progress');
    const resultsEl = document.getElementById('settings-netscan-results');

    btn.disabled = true;
    btn.textContent = 'Scanning Network...';
    prog.style.display = 'block';
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';

    const results = await DSPlixAPI.scanNetwork();

    btn.disabled = false;
    btn.textContent = '🔍 Scan Network';
    prog.style.display = 'none';

    if (!results) {
      window.DSPlixApp.showNotification('Network scan failed', 'error');
      return;
    }

    const hasHosts = results.networkHosts && results.networkHosts.length > 0;
    const hasDrives = results.mappedDrives && results.mappedDrives.length > 0;
    const hasShares = results.localShares && results.localShares.length > 0;

    if (!hasHosts && !hasDrives && !hasShares) {
      resultsEl.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;">No network hosts or shared drives found</p>';
      resultsEl.style.display = 'block';
      return;
    }

    let html = '';

    if (hasDrives) {
      html += '<div style="font-weight:700;font-size:11px;color:var(--text-muted);margin:8px 0 4px;text-transform:uppercase;">Mapped Drives</div>';
      results.mappedDrives.forEach(d => {
        html += `
          <div class="settings__netscan-item">
            <div style="flex:1;min-width:0;">
              <div class="settings__netscan-name">${this._esc(d.name)}</div>
              <div class="settings__netscan-path">${this._esc(d.path)}</div>
            </div>
            <button class="settings__netscan-add-btn" data-name="${this._esc(d.name)}" data-path="${this._esc(d.path)}" data-type="local">Use</button>
          </div>`;
      });
    }

    if (hasShares) {
      html += '<div style="font-weight:700;font-size:11px;color:var(--text-muted);margin:8px 0 4px;text-transform:uppercase;">Local Shares</div>';
      results.localShares.forEach(s => {
        html += `
          <div class="settings__netscan-item">
            <div style="flex:1;min-width:0;">
              <div class="settings__netscan-name">${this._esc(s.name)}</div>
              <div class="settings__netscan-path">${this._esc(s.path)} ${s.description ? '• ' + this._esc(s.description) : ''}</div>
            </div>
            <button class="settings__netscan-add-btn" data-name="${this._esc(s.name)}" data-path="${this._esc(s.path)}" data-type="local">Use</button>
          </div>`;
      });
    }

    if (hasHosts) {
      html += '<div style="font-weight:700;font-size:11px;color:var(--text-muted);margin:8px 0 4px;text-transform:uppercase;">Network Servers</div>';
      results.networkHosts.forEach(h => {
        const displayPath = h.type === 'smb' ? `\\\\${h.ip}` : `ftp://${h.ip}`;
        html += `
          <div class="settings__netscan-item">
            <div style="flex:1;min-width:0;">
              <div class="settings__netscan-name">${this._esc(h.ip)}</div>
              <div class="settings__netscan-path">${h.type.toUpperCase()} Server (Port ${h.port})</div>
            </div>
            <button class="settings__netscan-add-btn" data-name="${h.type.toUpperCase()}-${h.ip.split('.').pop()}" data-path="${this._esc(displayPath)}" data-type="${h.type}">Use</button>
          </div>`;
      });
    }

    resultsEl.innerHTML = html;
    resultsEl.style.display = 'block';

    // Wire up "Use" buttons
    resultsEl.querySelectorAll('.settings__netscan-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._openDirectoryBrowser(btn.dataset.path, btn.dataset.type, btn.dataset.name);
      });
    });
  },

  async _openDirectoryBrowser(basePath, type, name) {
    const resultsEl = document.getElementById('settings-netscan-results');
    
    const renderBrowser = async (currentPath) => {
      resultsEl.innerHTML = `<div style="text-align:center;padding:10px;"><div class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-radius:50%;border-top-color:#e50914;animation:spin 1s ease-in-out infinite;"></div></div>`;
      
      const data = await DSPlixAPI.browseNetwork(currentPath, type);
      
      let html = `
        <div style="display:flex;align-items:center;margin-bottom:8px;">
          <button id="browser-back-btn" class="settings__btn settings__btn--secondary" style="padding:4px 8px;margin-right:8px;font-size:12px;">← Back</button>
          <div style="flex:1;font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${this._esc(currentPath)}">${this._esc(currentPath)}</div>
          <button id="browser-select-btn" class="settings__btn settings__btn--primary" style="padding:4px 8px;font-size:12px;">Select Folder</button>
        </div>
      `;

      if (!data || !data.directories) {
        html += `<div style="text-align:center;font-size:12px;color:#e50914;padding:8px;">Failed to browse directory. Check permissions or path.</div>`;
      } else if (data.directories.length === 0) {
        html += `<div style="text-align:center;font-size:12px;color:var(--text-muted);padding:8px;">Empty directory</div>`;
      } else {
        data.directories.forEach(dir => {
          html += `
            <div class="settings__netscan-item browser-item" data-path="${this._esc(dir.path)}" style="cursor:pointer;padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;">
              <span style="margin-right:8px;">📁</span> <span style="flex:1;">${this._esc(dir.name)}</span>
            </div>`;
        });
      }
      
      resultsEl.innerHTML = html;

      const backBtn = document.getElementById('browser-back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          let parentPath = '';
          if (type === 'ftp') {
            try {
              const url = new URL(currentPath);
              const paths = url.pathname.split('/').filter(Boolean);
              if (paths.length === 0) { this._handleNetworkScan(); return; }
              paths.pop();
              url.pathname = '/' + paths.join('/');
              parentPath = url.href;
            } catch (e) {
               this._handleNetworkScan(); return;
            }
          } else {
            const isUnc = currentPath.startsWith('\\\\');
            const parts = currentPath.split(/[/\\]/).filter(Boolean);
            if (parts.length <= (isUnc ? 2 : 1)) {
               this._handleNetworkScan(); return;
            }
            parts.pop();
            parentPath = (isUnc ? '\\\\' : '') + parts.join('\\');
            if (!isUnc && parentPath.length === 2 && parentPath.endsWith(':')) {
               parentPath += '\\';
            }
          }
          renderBrowser(parentPath);
        });
      }

      const selectBtn = document.getElementById('browser-select-btn');
      if (selectBtn) {
        selectBtn.addEventListener('click', () => {
          document.getElementById('settings-src-name').value = name;
          document.getElementById('settings-src-path').value = currentPath;
          document.getElementById('settings-src-type').value = type === 'ftp' ? 'ftp' : (type === 'smb' ? 'smb' : 'local');
          document.getElementById('settings-src-type').dispatchEvent(new Event('change'));
          window.DSPlixApp.showNotification('Folder selected', 'info');
          resultsEl.style.display = 'none';
        });
      }

      resultsEl.querySelectorAll('.browser-item').forEach(item => {
        item.addEventListener('click', () => renderBrowser(item.dataset.path));
      });
    };

    renderBrowser(basePath);
  },

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
};
