const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { Transform } = require('stream');
const { getMediaById } = require('../db/database');
const {
  needsTranscoding,
  getHLSPath,
  transcodeToHLS,
  extractSubtitle,
  cleanupTranscodeCache,
  isTranscoding,
} = require('../services/transcoder');
const { getFileStream, getFileInfo, fileExists } = require('../services/smb');
const { getFtpFileInfo, getFtpStream } = require('../services/ftp');
const { acquireFtpProxy, parseRange } = require('../services/ftpProxy');
const hlsStarts = new Map();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** MIME types for browser-native video formats */
const MIME_MAP = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
};

/** Extensions that most browsers can play natively without transcoding */
const NATIVE_EXTENSIONS = new Set(['.mp4', '.webm']);

/**
 * Resolve the Content-Type for a video file based on its extension.
 * @param {string} filePath - Full path to the video file
 * @returns {string} MIME type string
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * Determine whether the container format is natively streamable in most browsers.
 * @param {string} filePath
 * @returns {boolean}
 */
function isNativeFormat(filePath) {
  return NATIVE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// GET /api/stream/:id — stream the video file
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const filePath = media.file_path;
    if (!filePath) {
      return res.status(404).json({ error: 'No file path associated with this media' });
    }

    const isFtp = filePath.startsWith('ftp://');

    // For FTP we use basic-ftp; for local and SMB (UNC paths) we use native fs
    const isAccessible = isFtp || fs.existsSync(filePath);

    if (!isAccessible) {
      return res.status(404).json({ error: 'Source file not found or inaccessible' });
    }

    // Decide: direct stream or HLS fallback
    const transcodeCheck = needsTranscoding(media);
    if (transcodeCheck.needsTranscode) {
      // Redirect to the HLS master playlist for non-native formats
      return res.redirect(`/api/stream/${req.params.id}/hls/master.m3u8`);
    }

    // --- Direct streaming with Range support --------------------------------
    const contentType = getContentType(filePath);
    let fileSize;
    let createStream;

    if (isFtp) {
      fileSize = Number(media.file_size) > 0 ? Number(media.file_size) : (await getFtpFileInfo(filePath)).size;
      createStream = (opts) => getFtpStream(filePath, opts);
    } else {
      const stat = fs.statSync(filePath);
      fileSize = stat.size;
      createStream = (opts) => fs.createReadStream(filePath, opts);
    }

    const range = req.headers.range;

    if (range) {
      const parsedRange = parseRange(range, fileSize);

      // Validate range bounds
      if (!parsedRange) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
        });
        return res.end();
      }
      const { start, end } = parsedRange;

      const chunkSize = end - start + 1;

      const stream = await createStream({ start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });

      if (isFtp) {
        let remaining = chunkSize;
        const limit = new Transform({
          transform(chunk, encoding, callback) {
            const part = chunk.subarray(0, remaining);
            remaining -= part.length;
            callback(null, part);
            if (remaining === 0) {
              this.end();
              stream.destroy();
            }
          },
        });
        stream.pipe(limit).pipe(res);
        stream.on('error', err => limit.destroy(err));
        limit.on('error', () => res.destroy());
      } else {
        stream.pipe(res);
      }

      // Handle client disconnects gracefully
      res.on('close', () => { if (!res.writableEnded) stream.destroy(); });
    } else {
      const stream = await createStream();
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });

      stream.pipe(res);
      stream.on('error', () => res.destroy());
      res.on('close', () => { if (!res.writableEnded) stream.destroy(); });
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/:id/hls/master.m3u8 — HLS master playlist
// ---------------------------------------------------------------------------
router.get('/:id/hls/master.m3u8', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media || !media.file_path) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Ensure transcoding has been kicked off
    const hlsDir = getHLSPath(media.id);

    const masterPath = path.join(hlsDir, 'master.m3u8');
    if (fs.existsSync(masterPath) && !isTranscoding(media.id)
        && !fs.readFileSync(masterPath, 'utf8').includes('#EXT-X-ENDLIST')) {
      cleanupTranscodeCache(media.id);
    }
    if (!fs.existsSync(masterPath)) {
      // Share one startup across simultaneous playlist requests.
      if (!hlsStarts.has(media.id)) {
        const start = (async () => {
          const proxy = media.source_type === 'ftp' ? await acquireFtpProxy(media.file_path, media.file_size) : null;
          try {
            await transcodeToHLS(proxy?.url || media.file_path, media.id, {
              videoCodec: media.video_codec, audioCodec: media.audio_codec,
              onClose: proxy?.release,
            });
          } catch (err) {
            proxy?.release();
            throw err;
          }
        })();
        hlsStarts.set(media.id, start);
        start.finally(() => hlsStarts.delete(media.id)).catch(() => {});
      }
      await hlsStarts.get(media.id);
    }

    // Poll briefly for the master playlist to become available
    const maxWait = 15000; // 15 s
    const interval = 500;
    let waited = 0;
    while (!fs.existsSync(masterPath) && waited < maxWait) {
      await new Promise((r) => setTimeout(r, interval));
      waited += interval;
    }

    if (!fs.existsSync(masterPath)) {
      return res.status(503).json({ error: 'Transcoding in progress, try again shortly' });
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(masterPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/:id/hls/:segment — individual .ts segment
// ---------------------------------------------------------------------------
router.get('/:id/hls/:segment', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media || !media.file_path) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const hlsDir = getHLSPath(media.id);
    const segmentName = path.basename(req.params.segment); // sanitise
    const segmentPath = path.join(hlsDir, segmentName);

    if (!fs.existsSync(segmentPath)) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    const ext = path.extname(segmentName).toLowerCase();
    const mime = ext === '.ts' ? 'video/mp2t' : 'application/vnd.apple.mpegurl';

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(segmentPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/:id/subtitle/:trackIndex — extract & serve subtitle as VTT
// ---------------------------------------------------------------------------
router.get('/:id/subtitle/:trackIndex', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media || !media.file_path) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const trackIndex = parseInt(req.params.trackIndex, 10);
    if (!Number.isFinite(trackIndex) || trackIndex < 0) {
      return res.status(400).json({ error: 'Invalid track index' });
    }

    // Generate subtitle cache path in the HLS cache directory for this media
    const hlsDir = getHLSPath(media.id);
    const outputPath = path.join(hlsDir, `subtitle_${trackIndex}.vtt`);

    // extractSubtitle returns a path to the cached VTT file
    const proxy = media.source_type === 'ftp' ? await acquireFtpProxy(media.file_path) : null;
    let vttPath;
    try {
      vttPath = await extractSubtitle(proxy?.url || media.file_path, trackIndex, outputPath);
    } finally {
      proxy?.release();
    }

    if (!vttPath || !fs.existsSync(vttPath)) {
      return res.status(404).json({ error: 'Subtitle track not available' });
    }

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(vttPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/:id/thumbnail — serve local thumbnail image
// ---------------------------------------------------------------------------
router.get('/:id/thumbnail', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media || !media.local_thumbnail) {
      return res.status(404).json({ error: 'Thumbnail not available' });
    }

    const thumbPath = media.local_thumbnail;
    if (!fs.existsSync(thumbPath)) {
      return res.status(404).json({ error: 'Thumbnail file not found on disk' });
    }

    const ext = path.extname(thumbPath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream/:id/info — stream / codec information
// ---------------------------------------------------------------------------
router.get('/:id/info', async (req, res, next) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media || !media.file_path) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Startup must not wait for an uncached FTP probe (large MP4s may seek to
    // the end of the file, costing many seconds). Scanning stores this data.
    const info = media;
    const transcodeRequired = needsTranscoding(info).needsTranscode;
    const tracks = value => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return []; }
      }
      return [];
    };

    // Build a lightweight info payload from whatever the media record stores.
    // Fields like video_codec, audio_codec, subtitle_tracks, etc. are expected
    // to have been populated by the scanner during indexing.
    res.json({
      needsTranscoding: transcodeRequired,
      videoCodec: info.video_codec || null,
      audioCodec: info.audio_codec || null,
      subtitleTracks: tracks(info.subtitle_tracks),
      audioTracks: tracks(info.audio_tracks),
      duration: info.duration || null,
      fileSize: info.file_size || null,
      container: path.extname(media.file_path).replace('.', ''),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
