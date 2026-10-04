/**
 * @fileoverview FFmpeg transcoding service for media streaming.
 *
 * Provides HLS adaptive streaming, subtitle extraction, thumbnail sprite
 * generation, and transcode cache management. All transcode processes are
 * tracked so they can be killed on demand or during cleanup.
 *
 * @module services/transcoder
 */

const { spawn, execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ffmpeg } = require('./mediaTools');

/* -------------------------------------------------------------------------- */
/*  FFmpeg availability detection                                             */
/* -------------------------------------------------------------------------- */

/** @type {boolean} Whether ffmpeg is available on the system PATH. */
let ffmpegAvailable = false;

try {
  execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch (_err) {
  ffmpegAvailable = false;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Video codecs natively decodable by modern browsers.
 * @type {string[]}
 */
const BROWSER_NATIVE_VIDEO_CODECS = ['h264', 'vp8', 'vp9', 'av1'];

/**
 * Audio codecs natively decodable by modern browsers.
 * @type {string[]}
 */
const BROWSER_NATIVE_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'vorbis'];

/**
 * Container formats that can be served directly to browsers.
 * @type {string[]}
 */
const BROWSER_NATIVE_CONTAINERS = ['.mp4', '.webm', '.ogg'];

/* -------------------------------------------------------------------------- */
/*  Module-level state                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Active transcode child processes keyed by media ID.
 * @type {Map<string|number, import('child_process').ChildProcess>}
 */
const activeProcesses = new Map();

/* -------------------------------------------------------------------------- */
/*  Helper utilities                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Normalise a codec string for comparison (lowercase, trimmed).
 *
 * @param {string} codec - Raw codec string.
 * @returns {string} Normalised codec name.
 */
function normaliseCodec(codec) {
  if (!codec) return '';
  return String(codec).toLowerCase().trim();
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Determine whether a media file needs transcoding for browser playback.
 *
 * Checks the video codec, audio codec, and container format against the
 * browser-native lists. If any component is non-native the file needs
 * transcoding.
 *
 * @param {object} mediaInfo - Media probe information.
 * @param {string} mediaInfo.video_codec - Video codec name (e.g. "h264", "hevc").
 * @param {string} mediaInfo.audio_codec - Audio codec name (e.g. "aac", "ac3").
 * @param {string} mediaInfo.file_path  - Full path to the media file.
 * @returns {{ needsVideo: boolean, needsAudio: boolean, needsTranscode: boolean, reason: string }}
 */
function needsTranscoding(mediaInfo) {
  const videoCodec = normaliseCodec(mediaInfo.video_codec);
  const audioCodec = normaliseCodec(mediaInfo.audio_codec);
  const ext = path.extname(mediaInfo.file_path || '').toLowerCase();

  const needsVideo = videoCodec ? !BROWSER_NATIVE_VIDEO_CODECS.includes(videoCodec) : false;
  const needsAudio = audioCodec ? !BROWSER_NATIVE_AUDIO_CODECS.includes(audioCodec) : false;
  const needsContainer = ext ? !BROWSER_NATIVE_CONTAINERS.includes(ext) : false;

  const reasons = [];
  if (needsVideo) reasons.push(`video codec "${videoCodec}" is not browser-native`);
  if (needsAudio) reasons.push(`audio codec "${audioCodec}" is not browser-native`);
  if (needsContainer) reasons.push(`container "${ext}" is not browser-native`);

  const needsTranscode = needsVideo || needsAudio || needsContainer;
  const reason = needsTranscode ? reasons.join('; ') : 'file is browser-native';

  return { needsVideo, needsAudio, needsTranscode, reason };
}

/**
 * Get (and lazily create) the HLS cache directory for a given media item.
 *
 * @param {string|number} mediaId - Unique identifier for the media item.
 * @returns {string} Absolute path to the HLS cache directory.
 */
function getHLSPath(mediaId) {
  const dataDir = process.env.DATA_DIR || './data';
  const hlsDir = path.join(dataDir, 'transcode-cache', String(mediaId));

  if (!fs.existsSync(hlsDir)) {
    fs.mkdirSync(hlsDir, { recursive: true });
  }

  return hlsDir;
}

/**
 * Transcode a media file to HLS (HTTP Live Streaming) format.
 *
 * The promise resolves once the first HLS segment has been written, meaning
 * playback can begin almost immediately. The ffmpeg process continues in the
 * background until the entire file has been transcoded.
 *
 * @param {string} inputPath - Path to the source media file.
 * @param {string|number} mediaId - Unique media identifier (used for cache keying).
 * @param {object} [options={}] - Transcoding options.
 * @param {number} [options.startTime] - Seek position in seconds before transcoding.
 * @param {number} [options.audioTrack] - Zero-based audio stream index to select.
 * @param {number} [options.subtitleTrack] - Zero-based subtitle stream index (currently unused in HLS mux).
 * @returns {Promise<{ playlistPath: string, hlsDir: string }>}
 *   Resolves with paths to the generated playlist and cache directory.
 */
function transcodeToHLS(inputPath, mediaId, options = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegAvailable) {
      return reject(new Error('ffmpeg is not installed or not found on PATH. Cannot transcode.'));
    }

    const hlsDir = getHLSPath(mediaId);
    const playlistPath = path.join(hlsDir, 'master.m3u8');
    const segmentPattern = path.join(hlsDir, 'segment_%05d.ts');

    /* ---- Build ffmpeg argument list ---- */

    /** @type {string[]} */
    const args = [];

    // Global flags
    args.push('-hide_banner', '-y');

    // Seek before input for fast start
    if (options.startTime && options.startTime > 0) {
      args.push('-ss', String(options.startTime));
    }

    // Input file
    args.push('-i', inputPath);

    // Video encoding
    // Repackage already-compatible H.264 instead of decoding and encoding it.
    // Unknown and unsupported codecs still get a browser-compatible output.
    const copyVideo = normaliseCodec(options.videoCodec) === 'h264';
    if (copyVideo) args.push('-c:v', 'copy');
    else args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25',
      '-force_key_frames', 'expr:gte(t,n_forced*2)');

    // Audio encoding
    args.push('-c:a', normaliseCodec(options.audioCodec) === 'aac' ? 'copy' : 'aac');

    // Select specific audio track
    if (typeof options.audioTrack === 'number') {
      args.push('-map', '0:v:0', '-map', `0:a:${options.audioTrack}`);
    } else {
      args.push('-map', '0:v:0', '-map', '0:a:0?');
    }

    // HLS muxer settings
    args.push(
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '0',
      '-hls_segment_filename', segmentPattern,
      '-hls_flags', 'delete_segments+append_list',
      playlistPath
    );

    /* ---- Spawn ffmpeg ---- */

    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Track in active map
    activeProcesses.set(mediaId, proc);

    /** Collected stderr for diagnostics. */
    let stderrData = '';

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on('error', (err) => {
      activeProcesses.delete(mediaId);
      options.onClose?.();
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });

    proc.on('close', (code) => {
      activeProcesses.delete(mediaId);
      options.onClose?.();
      // If we haven't resolved yet, the process ended before producing output
      // The watcher / poller below will handle that via its timeout.
    });

    /* ---- Wait for the first segment to appear ---- */

    let resolved = false;

    /**
     * Resolve the promise once the first segment or playlist file is detected.
     */
    function tryResolve() {
      if (resolved) return;
      if (fs.existsSync(playlistPath)) {
        resolved = true;
        resolve({ playlistPath, hlsDir });
      }
    }

    // Attempt to use fs.watch for instant notification
    let watcher = null;
    try {
      watcher = fs.watch(hlsDir, (eventType, filename) => {
        if (filename && filename.endsWith('.m3u8')) {
          tryResolve();
          if (watcher) {
            watcher.close();
            watcher = null;
          }
        }
      });

      watcher.on('error', () => {
        // Silently fall through to polling
        if (watcher) {
          watcher.close();
          watcher = null;
        }
      });
    } catch (_watchErr) {
      // fs.watch may fail on some platforms/network drives; fall through
    }

    // Polling fallback – check every 500ms for up to 60 seconds
    const pollInterval = setInterval(() => {
      tryResolve();
      if (resolved) {
        clearInterval(pollInterval);
        if (watcher) {
          watcher.close();
          watcher = null;
        }
      }
    }, 500);

    // Timeout after 60 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        clearInterval(pollInterval);
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        activeProcesses.delete(mediaId);
        proc.kill('SIGKILL');
        reject(new Error(
          `Timed out waiting for HLS segments. ffmpeg stderr:\n${stderrData.slice(-2000)}`
        ));
      }
    }, 60000);

    // Ensure timers are cleaned up if the process exits before resolve
    proc.on('close', () => {
      clearTimeout(timeout);
      clearInterval(pollInterval);
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (!resolved) {
        // Check one last time – ffmpeg may have finished very fast
        if (fs.existsSync(playlistPath)) {
          resolved = true;
          resolve({ playlistPath, hlsDir });
        } else {
          reject(new Error(
            `ffmpeg exited before producing HLS output. stderr:\n${stderrData.slice(-2000)}`
          ));
        }
      }
    });
  });
}

/**
 * Extract a subtitle track from a media file and convert it to WebVTT.
 *
 * @param {string} inputPath - Path to the source media file.
 * @param {number} trackIndex - Zero-based subtitle stream index.
 * @param {string} outputPath - Destination path for the .vtt file.
 * @returns {Promise<string>} Resolves with the output path on success.
 */
function extractSubtitle(inputPath, trackIndex, outputPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegAvailable) {
      return reject(new Error('ffmpeg is not installed or not found on PATH.'));
    }

    // Ensure output directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const args = [
      '-hide_banner', '-y',
      '-i', inputPath,
      '-map', `0:s:${trackIndex}`,
      '-c:s', 'webvtt',
      outputPath
    ];

    execFile(ffmpeg, args, { timeout: 120000 }, (error, _stdout, stderr) => {
      if (error) {
        return reject(new Error(
          `Subtitle extraction failed (track ${trackIndex}): ${error.message}\nffmpeg: ${stderr ? stderr.slice(-1000) : ''}`
        ));
      }
      resolve(outputPath);
    });
  });
}

/**
 * Generate a thumbnail sprite sheet for seek preview scrubbing.
 *
 * Extracts `count` evenly-spaced frames from the video and tiles them into
 * a single image. The sprite is written to `outputPath`.
 *
 * @param {string} inputPath - Path to the source media file.
 * @param {string} outputPath - Destination path for the sprite image (e.g. .jpg).
 * @param {number} [count=20] - Number of thumbnails to extract.
 * @returns {Promise<string>} Resolves with the output path on success.
 */
function generateThumbnailSprite(inputPath, outputPath, count = 20) {
  return new Promise((resolve, reject) => {
    if (!ffmpegAvailable) {
      return reject(new Error('ffmpeg is not installed or not found on PATH.'));
    }

    // Ensure output directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Calculate columns for the tile layout (roughly square grid)
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    // Use fps filter to extract evenly-spaced frames, scale them down,
    // then tile into a single sprite sheet.
    const args = [
      '-hide_banner', '-y',
      '-i', inputPath,
      '-vf', [
        `select='not(mod(n\\,floor(n_frames/${count})))'`,
        'scale=160:-1',
        `tile=${cols}x${rows}`
      ].join(','),
      '-frames:v', '1',
      '-q:v', '5',
      outputPath
    ];

    execFile(ffmpeg, args, { timeout: 300000 }, (error, _stdout, stderr) => {
      if (error) {
        // Retry with a simpler fps-based approach if frame selection fails
        // (n_frames is not always available)
        const fallbackArgs = [
          '-hide_banner', '-y',
          '-i', inputPath,
          '-vf', [
            `fps=fps=${count}/60`,
            'scale=160:-1',
            `tile=${cols}x${rows}`
          ].join(','),
          '-frames:v', '1',
          '-q:v', '5',
          outputPath
        ];

        execFile(ffmpeg, fallbackArgs, { timeout: 300000 }, (err2, _out2, stderr2) => {
          if (err2) {
            return reject(new Error(
              `Thumbnail sprite generation failed: ${err2.message}\nffmpeg: ${stderr2 ? stderr2.slice(-1000) : ''}`
            ));
          }
          resolve(outputPath);
        });
        return;
      }
      resolve(outputPath);
    });
  });
}

/**
 * Remove the HLS transcode cache for a specific media item.
 *
 * Kills any active transcode process for the media before deleting files.
 *
 * @param {string|number} mediaId - The media identifier whose cache to delete.
 * @returns {void}
 */
function cleanupTranscodeCache(mediaId) {
  // Kill active process first
  killProcess(mediaId);

  const dataDir = process.env.DATA_DIR || './data';
  const hlsDir = path.join(dataDir, 'transcode-cache', String(mediaId));

  if (fs.existsSync(hlsDir)) {
    fs.rmSync(hlsDir, { recursive: true, force: true });
  }
}

/**
 * Remove the entire transcode cache directory and kill all active processes.
 *
 * @returns {void}
 */
function cleanupAllCache() {
  // Kill every active process
  for (const [mediaId] of activeProcesses) {
    killProcess(mediaId);
  }

  const dataDir = process.env.DATA_DIR || './data';
  const cacheRoot = path.join(dataDir, 'transcode-cache');

  if (fs.existsSync(cacheRoot)) {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
}

/**
 * Kill an active transcode process for a media item.
 *
 * Sends SIGKILL to terminate the ffmpeg child process and removes it from
 * the active processes map.
 *
 * @param {string|number} mediaId - The media identifier whose process to kill.
 * @returns {boolean} `true` if a process was found and killed, `false` otherwise.
 */
function killProcess(mediaId) {
  const proc = activeProcesses.get(mediaId);
  if (!proc) return false;

  try {
    proc.kill('SIGKILL');
  } catch (_err) {
    // Process may have already exited
  }

  activeProcesses.delete(mediaId);
  return true;
}

function isTranscoding(mediaId) {
  return activeProcesses.has(mediaId);
}

/* -------------------------------------------------------------------------- */
/*  Exports                                                                   */
/* -------------------------------------------------------------------------- */

module.exports = {
  ffmpegAvailable,
  BROWSER_NATIVE_VIDEO_CODECS,
  BROWSER_NATIVE_AUDIO_CODECS,
  BROWSER_NATIVE_CONTAINERS,
  needsTranscoding,
  getHLSPath,
  transcodeToHLS,
  extractSubtitle,
  generateThumbnailSprite,
  cleanupTranscodeCache,
  cleanupAllCache,
  killProcess,
  isTranscoding,
};
