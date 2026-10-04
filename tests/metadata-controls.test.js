'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('manual TMDB match and removal survive later scans', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-plix-metadata-'));
  const previousDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const db = require('../src/db/database');
  try {
    const filePath = 'ftp://user:secret@example.test/Movies/Example.mkv';
    const discovered = {
      title: 'Example', original_filename: 'Example.mkv', file_path: filePath,
      source_type: 'ftp', media_type: 'movie', file_size: 100,
    };
    db.insertDiscoveredMedia(discovered);
    const id = db.getDb().prepare('SELECT id FROM media WHERE file_path = ?').get(filePath).id;
    db.setMediaTmdbInfo(id, {
      title: 'Chosen Film', media_type: 'movie', tmdb_id: 42,
      year: 2020, genre: '["Drama"]', overview: 'Correct match', rating: 8,
      runtime: 90, poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
    });
    db.upsertMedia({ ...discovered, title: 'Wrong automatic match', tmdb_id: 999, year: 2025 });
    assert.equal(db.getMediaById(id).title, 'Chosen Film');
    assert.equal(db.getMediaById(id).tmdb_id, 42);

    db.clearMediaTmdbInfo(id, 'Example', 'movie');
    db.upsertMedia({ ...discovered, title: 'Wrong automatic match', tmdb_id: 999, year: 2025 });
    const cleared = db.getMediaById(id);
    assert.equal(cleared.title, 'Example');
    assert.equal(cleared.tmdb_id, null);
    assert.equal(cleared.poster_path, null);
    assert.equal(cleared.metadata_locked, 1);
  } finally {
    db.closeDb();
    if (previousDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDir;
    const resolved = fs.realpathSync(dataDir);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    if (!resolved.toLowerCase().startsWith(temporaryRoot.toLowerCase() + path.sep)) throw new Error('Temporary test path escaped its root');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
