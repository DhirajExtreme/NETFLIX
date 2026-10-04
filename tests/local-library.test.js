'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { browseLocal, validateLocalSelection } = require('../src/services/localLibrary');
const { scanDirectory, isWithinSource } = require('../src/services/scanner');

test('local browser finds video files and the scanner accepts one selected file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-plix-local-'));
  const video = path.join(directory, 'Sample.mp4');
  const note = path.join(directory, 'note.txt');
  try {
    fs.writeFileSync(video, 'video fixture');
    fs.writeFileSync(note, 'not media');
    fs.mkdirSync(path.join(directory, 'Movies'));
    const listed = await browseLocal(directory);
    assert.deepEqual(listed.files.map(file => file.name), ['Sample.mp4']);
    assert.deepEqual(listed.directories.map(folder => folder.name), ['Movies']);
    assert.equal(await validateLocalSelection(video, 'file'), video);
    await assert.rejects(validateLocalSelection(note, 'file'));
    const scanned = await scanDirectory(video, 'local');
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0].filePath, video);
    const source = { source_type: 'local', item_kind: 'file', path: video };
    assert.equal(isWithinSource({ source_type: 'local', file_path: video }, source), true);
    assert.equal(isWithinSource({ source_type: 'local', file_path: video + '.other' }, source), false);
  } finally {
    const resolved = fs.realpathSync(directory);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    if (!resolved.toLowerCase().startsWith(temporaryRoot.toLowerCase() + path.sep)) throw new Error('Temporary test path escaped its root');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
