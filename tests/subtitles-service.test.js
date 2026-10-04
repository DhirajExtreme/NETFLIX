'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('OpenSubtitles search and authenticated download use server-side credentials', async () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const workspace = fs.mkdtempSync(path.join(tempRoot, 'ds-plix-os-api-'));
  const oldData = process.env.DATA_DIR;
  const oldFetch = global.fetch;
  process.env.DATA_DIR = workspace;
  const { setSetting, closeDb } = require('../src/db/database');
  const subtitles = require('../src/services/subtitles');
  setSetting('opensubtitles_api_key', 'test-key');
  setSetting('opensubtitles_username', 'test-user');
  setSetting('opensubtitles_password', 'test-password');
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/subtitles?')) return Response.json({ data: [{ attributes: { files: [{ file_id: 42 }], release: 'Movie release', language: 'en' } }] });
    if (String(url).endsWith('/login')) return Response.json({ token: 'token', base_url: 'vip-api.opensubtitles.com' });
    if (String(url).endsWith('/download')) return Response.json({ link: 'https://www.opensubtitles.com/subtitle.srt', file_name: 'subtitle.srt' });
    return new Response('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
  };
  try {
    const found = await subtitles.search({ query: 'Movie', language: 'en' });
    assert.equal(found[0].id, 42);
    const file = await subtitles.download(42);
    assert.equal(file.filename, 'subtitle.srt');
    assert.match(file.buffer.toString(), /Hello/);
    assert.equal(calls[0].options.headers['Api-Key'], 'test-key');
    assert.equal(calls[2].options.headers.Authorization, 'Bearer token');
    assert.equal(calls[2].url, 'https://vip-api.opensubtitles.com/api/v1/download');
    assert.doesNotMatch(calls[0].url, /test-password/);
  } finally {
    global.fetch = oldFetch;
    closeDb();
    if (oldData === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldData;
    const resolved = fs.realpathSync(workspace);
    if (!resolved.toLowerCase().startsWith(tempRoot.toLowerCase() + path.sep)) throw new Error('Temporary test path escaped its root');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
