'use strict';

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateLocalSelection } = require('../services/localLibrary');
const { probeFile } = require('../services/scanner');
const { needsTranscoding, getHLSPath, transcodeToHLS, cleanupTranscodeCache, isTranscoding } = require('../services/transcoder');
const { parseRange } = require('../services/ftpProxy');

const sessions = new Map();
const TTL = 4 * 60 * 60 * 1000;
const cacheRoot = path.resolve(process.env.DATA_DIR || './data', 'transcode-cache');
if (fs.existsSync(cacheRoot)) {
  for (const name of fs.readdirSync(cacheRoot)) {
    if (/^private-[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(name)) {
      const target = path.resolve(cacheRoot, name);
      if (target.startsWith(cacheRoot + path.sep)) cleanupTranscodeCache(name);
    }
  }
}
const localOnly = (req, res, next) => {
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return next();
  res.status(403).json({ error: 'Open private files from the laptop running DS PLIX' });
};
const cacheId = token => `private-${token}`;
const destroy = token => {
  sessions.delete(token);
  cleanupTranscodeCache(cacheId(token));
};
setInterval(() => {
  for (const [token, session] of sessions) if (session.expires < Date.now()) destroy(token);
}, 60_000).unref();

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/open', localOnly, async (req, res) => {
  try {
    const filePath = await validateLocalSelection(req.body?.path, 'file');
    const stat = await fs.promises.stat(filePath);
    const probe = await probeFile(filePath).catch(() => null);
    const token = crypto.randomUUID();
    const session = {
      filePath, title: path.basename(filePath), size: stat.size,
      video_codec: probe?.video_codec || null, audio_codec: probe?.audio_codec || null,
      subtitleTracks: probe?.subtitle_tracks || [], expires: Date.now() + TTL,
    };
    sessions.set(token, session);
    res.status(201).json({ token, title: session.title, needsTranscoding: needsTranscoding({ ...session, file_path: filePath }).needsTranscode,
      contentType: path.extname(filePath).toLowerCase() === '.webm' ? 'video/webm' : path.extname(filePath).toLowerCase() === '.ogg' ? 'video/ogg' : 'video/mp4',
      subtitleTracks: session.subtitleTracks });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.use('/:token', (req, res, next) => {
  const session = sessions.get(req.params.token);
  if (!session || session.expires < Date.now()) {
    if (session) destroy(req.params.token);
    return res.status(404).json({ error: 'Private session expired' });
  }
  req.privateSession = session;
  next();
});

router.get('/:token/stream', async (req, res, next) => {
  try {
    const session = req.privateSession;
    if (needsTranscoding({ ...session, file_path: session.filePath }).needsTranscode) {
      return res.redirect(`/api/private/${req.params.token}/hls/master.m3u8`);
    }
    const stat = await fs.promises.stat(session.filePath);
    const range = req.headers.range ? parseRange(req.headers.range, stat.size) : null;
    if (req.headers.range && !range) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    res.status(range ? 206 : 200).set({
      'Content-Type': path.extname(session.filePath).toLowerCase() === '.webm' ? 'video/webm' : path.extname(session.filePath).toLowerCase() === '.ogg' ? 'video/ogg' : 'video/mp4',
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
    });
    const stream = fs.createReadStream(session.filePath, { start, end });
    stream.on('error', next).pipe(res);
    res.on('close', () => { if (!res.writableEnded) stream.destroy(); });
  } catch (error) { next(error); }
});

router.get('/:token/hls/master.m3u8', async (req, res, next) => {
  try {
    const id = cacheId(req.params.token);
    const playlist = path.join(getHLSPath(id), 'master.m3u8');
    if (fs.existsSync(playlist) && !isTranscoding(id) && !fs.readFileSync(playlist, 'utf8').includes('#EXT-X-ENDLIST')) cleanupTranscodeCache(id);
    if (!fs.existsSync(playlist) && !req.privateSession.start) {
      req.privateSession.start = transcodeToHLS(req.privateSession.filePath, id, {
        videoCodec: req.privateSession.video_codec, audioCodec: req.privateSession.audio_codec,
      }).finally(() => { req.privateSession.start = null; });
    }
    if (req.privateSession.start) await req.privateSession.start;
    if (!fs.existsSync(playlist)) return res.status(503).json({ error: 'Preparing video' });
    res.type('application/vnd.apple.mpegurl');
    fs.createReadStream(playlist).pipe(res);
  } catch (error) { next(error); }
});

router.get('/:token/hls/:segment', (req, res) => {
  if (!/^segment_\d{5}\.ts$/.test(req.params.segment)) return res.status(404).end();
  const filename = path.join(getHLSPath(cacheId(req.params.token)), req.params.segment);
  if (!fs.existsSync(filename)) return res.status(404).end();
  res.type('video/mp2t');
  fs.createReadStream(filename).pipe(res);
});

router.delete('/:token', (req, res) => { destroy(req.params.token); res.json({ success: true }); });

module.exports = router;
