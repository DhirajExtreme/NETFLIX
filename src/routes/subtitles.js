'use strict';

const router = require('express').Router();
const express = require('express');
const fs = require('fs');
const { getMediaById } = require('../db/database');
const subtitles = require('../services/subtitles');

router.use('/:mediaId', async (req, res, next) => {
  const media = await getMediaById(req.params.mediaId);
  if (!media) return res.status(404).json({ error: 'Media not found' });
  req.media = media;
  next();
});

router.get('/:mediaId', (req, res) => res.json({ items: subtitles.list(req.media.id) }));

router.post('/:mediaId/local', express.raw({ type: 'application/octet-stream', limit: '2mb' }), async (req, res) => {
  try {
    const item = await subtitles.save(req.media.id, {
      buffer: req.body, filename: String(req.query.filename || ''),
      label: String(req.query.label || ''), language: String(req.query.language || 'en'), source: 'local',
    });
    res.status(201).json(item);
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get('/:mediaId/online', async (req, res) => {
  try {
    const items = await subtitles.search({
      query: String(req.query.query || req.media.title), tmdbId: req.media.tmdb_id,
      language: String(req.query.language || 'en'),
    });
    res.json({ items });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

router.post('/:mediaId/online', async (req, res) => {
  try {
    const fileId = Number(req.body?.fileId);
    if (!Number.isSafeInteger(fileId) || fileId <= 0) return res.status(400).json({ error: 'Invalid subtitle file' });
    const { buffer, filename } = await subtitles.download(fileId);
    const item = await subtitles.save(req.media.id, {
      buffer, filename, label: String(req.body.label || filename),
      language: String(req.body.language || 'en'), source: 'OpenSubtitles',
    });
    res.status(201).json(item);
  } catch (error) { res.status(502).json({ error: error.message }); }
});

router.get('/:mediaId/:subtitleId/file', (req, res) => {
  const filename = subtitles.file(req.media.id, Number(req.params.subtitleId));
  if (!filename || !fs.existsSync(filename)) return res.status(404).end();
  res.type('text/vtt').set('Cache-Control', 'no-store');
  fs.createReadStream(filename).pipe(res);
});

router.delete('/:mediaId/:subtitleId', (req, res) => {
  if (!subtitles.remove(req.media.id, Number(req.params.subtitleId))) return res.status(404).json({ error: 'Subtitle not found' });
  res.json({ success: true });
});

module.exports = router;
