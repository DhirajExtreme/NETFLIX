'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('local captions persist; private playback supports ranges without creating history', { timeout: 30000 }, async () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const workspace = fs.mkdtempSync(path.join(tempRoot, 'ds-plix-subtitle-private-'));
  const video = path.join(workspace, 'sample.mp4');
  fs.writeFileSync(video, Buffer.from('0123456789'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(workspace, 'data'), TMDB_API_KEY: 'your_tmdb_api_key_here' },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      try { ready = (await fetch(`${base}/api/settings`, { signal: AbortSignal.timeout(400) })).ok; }
      catch { await delay(100); }
    }
    assert.equal(ready, true);
    const opened = await fetch(`${base}/api/private/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: video }),
    });
    assert.equal(opened.status, 201);
    const session = await opened.json();
    const stream = await fetch(`${base}/api/private/${session.token}/stream`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(stream.status, 206);
    assert.equal(await stream.text(), '2345');
    assert.equal((await (await fetch(`${base}/api/media?limit=10`)).json()).items.length, 0);
    assert.equal((await (await fetch(`${base}/api/history`)).json()).items.length, 0);
    assert.equal((await fetch(`${base}/api/private/${session.token}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/private/${session.token}/stream`)).status, 404);

    const add = await fetch(`${base}/api/library/local/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ path: video, kind: 'file' }] }),
    });
    assert.equal(add.status, 201);
    const mediaId = (await add.json()).ids[0];
    const caption = '1\n00:00:01,000 --> 00:00:02,000\nHello world\n';
    const upload = await fetch(`${base}/api/subtitles/${mediaId}/local?filename=English.srt&language=en`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: caption,
    });
    assert.equal(upload.status, 201);
    const subtitle = await upload.json();
    const vtt = await (await fetch(`${base}/api/subtitles/${mediaId}/${subtitle.id}/file`)).text();
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /00:00:01\.000 --> 00:00:02\.000/);
    assert.equal((await (await fetch(`${base}/api/subtitles/${mediaId}`)).json()).items.length, 1);
    assert.equal((await fetch(`${base}/api/subtitles/${mediaId}/${subtitle.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/subtitles/${mediaId}/${subtitle.id}/file`)).status, 404);
    const progress = await fetch(`${base}/api/history/${mediaId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: 15, duration: 100 }),
    });
    assert.equal(progress.status, 200);
    assert.equal((await (await fetch(`${base}/api/history`)).json()).items[0].progress, 15);
  } finally {
    child.kill();
    await delay(300);
    const resolved = fs.realpathSync(workspace);
    if (!resolved.toLowerCase().startsWith(tempRoot.toLowerCase() + path.sep)) throw new Error('Temporary test path escaped its root');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
