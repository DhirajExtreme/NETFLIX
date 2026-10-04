const router = require('express').Router();
const {
  getMediaById,
  updateWatchProgress,
  getAllWatchHistory,
  deleteWatchHistory,
} = require('../db/database');

// ---------------------------------------------------------------------------
// POST /api/history/:mediaId — update watch progress
// ---------------------------------------------------------------------------
router.post('/:mediaId', async (req, res, next) => {
  try {
    const { mediaId } = req.params;

    // Validate the referenced media exists
    const media = await getMediaById(mediaId);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const { progress, duration } = req.body || {};

    if (!Number.isFinite(progress) || !Number.isFinite(duration)) {
      return res.status(400).json({
        error: 'Both "progress" (number) and "duration" (number) are required',
      });
    }

    if (progress < 0 || duration <= 0) {
      return res.status(400).json({
        error: '"progress" must be >= 0 and "duration" must be > 0',
      });
    }

    const record = await updateWatchProgress(mediaId, progress, duration);

    res.json({ success: true, ...record });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/history — full watch history
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
    const items = await getAllWatchHistory(limit);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/history/:mediaId — clear history for a single item
// ---------------------------------------------------------------------------
router.delete('/:mediaId', async (req, res, next) => {
  try {
    const { mediaId } = req.params;
    await deleteWatchHistory(mediaId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
