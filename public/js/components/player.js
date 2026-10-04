/**
 * Video Player Component — Video.js wrapper with custom controls
 */
window.PlayerComponent = {
  _player: null,
  _mediaId: null,
  _privateToken: null,
  _privateSubtitleUrl: null,
  _progressInterval: null,
  _speeds: [1, 1.25, 1.5, 2, 0.5, 0.75],
  _speedIndex: 0,

  async play(mediaId, startTime = 0) {
    if (this._privateToken) this.stop();
    this._mediaId = mediaId;
    document.getElementById('player-private-subtitle').hidden = true;
    const overlay = document.getElementById('player-overlay');
    overlay.classList.remove('hide');
    document.body.style.overflow = 'hidden';

    // Get media info
    const media = await DSPlixAPI.getMediaById(mediaId);
    const streamInfo = await DSPlixAPI.getStreamInfo(mediaId);

    // Set title
    const titleEl = document.getElementById('player-title');
    if (media) titleEl.textContent = media.title;

    // Determine source
    let src, type;
    if (streamInfo && streamInfo.needsTranscoding) {
      src = DSPlixAPI.getHLSUrl(mediaId);
      type = 'application/x-mpegURL';
    } else {
      src = DSPlixAPI.getStreamUrl(mediaId);
      type = streamInfo?.container === 'webm' ? 'video/webm' : streamInfo?.container === 'ogg' ? 'video/ogg' : 'video/mp4';
    }

    const extra = await DSPlixAPI.getSubtitles(mediaId);
    this._openSource(src, type, startTime,
      [...(streamInfo?.subtitleTracks || []).map((track, i) => ({ ...track, src: DSPlixAPI.getSubtitleUrl(mediaId, track.index != null ? track.index : i) })),
        ...(extra?.items || []).map(track => ({ ...track, src: DSPlixAPI.getExternalSubtitleUrl(mediaId, track.id) }))]);
    this._startProgressSaving();
  },

  playPrivate(session) {
    if (this._mediaId || this._privateToken) this.stop();
    this._privateToken = session.token;
    this._mediaId = null;
    document.getElementById('player-private-subtitle').hidden = false;
    document.getElementById('player-overlay').classList.remove('hide');
    document.body.style.overflow = 'hidden';
    document.getElementById('player-title').textContent = `Private · ${session.title}`;
    const base = `/api/private/${session.token}`;
    this._openSource(session.needsTranscoding ? `${base}/hls/master.m3u8` : `${base}/stream`,
      session.needsTranscoding ? 'application/x-mpegURL' : session.contentType, 0, []);
  },

  _openSource(src, type, startTime, tracks) {
    if (this._player) {
      this._player.src({ src, type });
    } else {
      this._player = videojs('video-player', {
        controls: true,
        autoplay: false,
        preload: 'auto',
        fluid: true,
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
        html5: {
          vhs: { overrideNative: true },
          nativeAudioTracks: false,
          nativeVideoTracks: false,
        },
        sources: [{ src, type }],
      });
      this.setupControls();
      this._setupKeyboard();
    }

    // Add subtitle tracks
    this._addSubtitleTracks(tracks);

    // Start time
    this._player.one('loadedmetadata', () => {
      if (startTime > 0) this._player.currentTime(startTime);
      this._player.play().catch(() => {});
    });

    // If already loaded (same source), try play
    if (this._player.readyState() >= 1 && startTime > 0) {
      this._player.currentTime(startTime);
    }
    this._player.play().catch(() => {});

  },

  stop() {
    this._saveProgress();
    if (this._progressInterval) { clearInterval(this._progressInterval); this._progressInterval = null; }
    if (this._player) { this._player.pause(); this._player.currentTime(0); }
    document.getElementById('player-overlay').classList.add('hide');
    document.body.style.overflow = '';
    this._mediaId = null;
    if (this._privateToken) {
      DSPlixAPI.closePrivate(this._privateToken);
      this._privateToken = null;
    }
    if (this._privateSubtitleUrl) { URL.revokeObjectURL(this._privateSubtitleUrl); this._privateSubtitleUrl = null; }
    document.getElementById('player-private-subtitle').hidden = true;
  },

  _startProgressSaving() {
    if (this._progressInterval) clearInterval(this._progressInterval);
    this._progressInterval = setInterval(() => this._saveProgress(), 10000);
  },

  _saveProgress() {
    if (!this._player || !this._mediaId) return;
    const progress = this._player.currentTime();
    const duration = this._player.duration();
    if (progress > 0 && duration > 0 && isFinite(duration)) {
      DSPlixAPI.updateProgress(this._mediaId, progress, duration);
    }
  },

  setupControls() {
    const player = this._player;
    const controlBar = player.getChild('controlBar');

    // Skip backward -10s
    const skipBackBtn = document.createElement('div');
    skipBackBtn.className = 'vjs-custom-skip-btn vjs-control';
    skipBackBtn.innerHTML = '⏪10';
    skipBackBtn.title = 'Skip back 10s';
    skipBackBtn.addEventListener('click', () => player.currentTime(Math.max(0, player.currentTime() - 10)));

    // Skip forward +10s
    const skipFwdBtn = document.createElement('div');
    skipFwdBtn.className = 'vjs-custom-skip-btn vjs-control';
    skipFwdBtn.innerHTML = '10⏩';
    skipFwdBtn.title = 'Skip forward 10s';
    skipFwdBtn.addEventListener('click', () => player.currentTime(Math.min(player.duration(), player.currentTime() + 10)));

    // Speed toggle
    const speedBtn = document.createElement('div');
    speedBtn.className = 'vjs-custom-speed-btn vjs-control';
    speedBtn.innerHTML = '1x';
    speedBtn.title = 'Playback speed';
    speedBtn.addEventListener('click', () => {
      this._speedIndex = (this._speedIndex + 1) % this._speeds.length;
      const speed = this._speeds[this._speedIndex];
      player.playbackRate(speed);
      speedBtn.innerHTML = speed + 'x';
    });

    const bar = controlBar.el();
    const playBtn = bar.querySelector('.vjs-play-control');
    if (playBtn) {
      playBtn.after(skipBackBtn);
      skipBackBtn.after(skipFwdBtn);
    }
    bar.appendChild(speedBtn);

    // Back button
    document.getElementById('player-back-btn').addEventListener('click', () => this.stop());
    document.getElementById('player-private-subtitle').addEventListener('click', () => document.getElementById('player-private-subtitle-file').click());
    document.getElementById('player-private-subtitle-file').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!this._privateToken || !file || file.size > 2 * 1024 * 1024) return;
      let content = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      if (file.name.toLowerCase().endsWith('.srt')) {
        content = `WEBVTT\n\n${content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
      }
      if (!content.startsWith('WEBVTT')) { window.DSPlixApp.showNotification('Choose a valid .srt or .vtt subtitle', 'error'); return; }
      if (this._privateSubtitleUrl) URL.revokeObjectURL(this._privateSubtitleUrl);
      this._privateSubtitleUrl = URL.createObjectURL(new Blob([content], { type: 'text/vtt' }));
      this._addSubtitleTracks([{ label: file.name, language: 'en', src: this._privateSubtitleUrl }]);
      event.target.value = '';
    });
  },

  _addSubtitleTracks(tracks) {
    if (!this._player || !tracks) return;
    // Remove old text tracks
    const existingTracks = this._player.remoteTextTracks();
    for (let i = existingTracks.length - 1; i >= 0; i--) {
      this._player.removeRemoteTextTrack(existingTracks[i]);
    }
    // Add new
    tracks.forEach((track, i) => {
      this._player.addRemoteTextTrack({
        kind: 'subtitles',
        label: track.language || track.title || `Subtitle ${i + 1}`,
        srclang: track.language || 'en',
        src: track.src,
        default: i === 0,
      }, false);
    });
  },

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      const overlay = document.getElementById('player-overlay');
      if (overlay.classList.contains('hide') || !this._player) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          this._player.paused() ? this._player.play() : this._player.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this._player.currentTime(Math.max(0, this._player.currentTime() - 10));
          break;
        case 'ArrowRight':
          e.preventDefault();
          this._player.currentTime(Math.min(this._player.duration(), this._player.currentTime() + 10));
          break;
        case 'ArrowUp':
          e.preventDefault();
          this._player.volume(Math.min(1, this._player.volume() + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          this._player.volume(Math.max(0, this._player.volume() - 0.1));
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          this._player.isFullscreen() ? this._player.exitFullscreen() : this._player.requestFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          this._player.muted(!this._player.muted());
          break;
        case 'Escape':
          e.preventDefault();
          this.stop();
          break;
      }
    });
  },
};
