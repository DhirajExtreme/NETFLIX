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

test('adding one laptop video indexes it and a full scan keeps it', { timeout: 30000 }, async () => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const workspace = fs.mkdtempSync(path.join(temporaryRoot, 'ds-plix-local-api-'));
  const video = path.join(workspace, 'IMG_sample.mp4');
  fs.writeFileSync(video, 'invalid video fixture');
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
      try { ready = (await fetch(`${base}/api/library/local/locations`, { signal: AbortSignal.timeout(400) })).ok; }
      catch { await delay(100); }
    }
    assert.equal(ready, true, 'isolated server started');
    const add = await fetch(`${base}/api/library/local/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ path: video, kind: 'file' }] }),
    });
    assert.equal(add.status, 201);
    const added = await add.json();
    assert.equal(added.ids.length, 1);
    for (let i = 0; i < 100; i++) {
      const status = await (await fetch(`${base}/api/library/scan/status`)).json();
      if (!status.scanning) break;
      await delay(100);
    }
    const scan = await fetch(`${base}/api/library/scan`, { method: 'POST' });
    assert.equal(scan.status, 200);
    for (let i = 0; i < 100; i++) {
      const status = await (await fetch(`${base}/api/library/scan/status`)).json();
      if (!status.scanning) break;
      await delay(100);
    }
    const media = await (await fetch(`${base}/api/media?limit=10`)).json();
    assert.equal(media.items.length, 1);
    assert.equal(media.items[0].original_filename, 'IMG_sample.mp4');
    const sources = await (await fetch(`${base}/api/library/sources`)).json();
    assert.equal(sources.sources[0].item_kind, 'file');
  } finally {
    child.kill();
    await delay(300);
    const resolved = fs.realpathSync(workspace);
    if (!resolved.toLowerCase().startsWith(temporaryRoot.toLowerCase() + path.sep)) throw new Error('Temporary test path escaped its root');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
