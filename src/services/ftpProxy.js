'use strict';

const http = require('http');
const { randomUUID } = require('crypto');
const { Transform } = require('stream');
const { getFtpFileInfo, getFtpStream } = require('./ftp');

const files = new Map();
let server;
let listening;

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return false;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  end = Math.min(end, size - 1);
  return { start, end };
}

async function serve(req, res) {
  const file = files.get(req.url.slice(1));
  if (!file || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404).end();
    return;
  }
  let stream;
  try {
    const ftpUrl = file.url;
    const size = file.size || (await getFtpFileInfo(ftpUrl)).size;
    const range = parseRange(req.headers.range, size);
    if (range === false) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    const start = range?.start || 0;
    const end = range?.end ?? size - 1;
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    if (req.method === 'HEAD') {
      res.writeHead(range ? 206 : 200, headers).end();
      return;
    }
    stream = await getFtpStream(ftpUrl, { start });
    res.writeHead(range ? 206 : 200, headers);
    let remaining = end - start + 1;
    const limiter = new Transform({
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
    stream.on('error', err => limiter.destroy(err));
    limiter.on('error', () => res.destroy());
    stream.pipe(limiter).pipe(res);
    res.on('close', () => { if (!res.writableEnded) stream.destroy(); });
  } catch {
    if (!res.headersSent) res.writeHead(502).end();
    else res.destroy();
    if (stream) stream.destroy();
  }
}

async function acquireFtpProxy(ftpUrl, knownSize = null) {
  if (!listening) {
    server = http.createServer((req, res) => { serve(req, res); });
    listening = new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.unref();
        resolve(server.address().port);
      });
    });
  }
  const port = await listening;
  const token = randomUUID();
  files.set(token, { url: ftpUrl, size: Number(knownSize) > 0 ? Number(knownSize) : null });
  return {
    url: `http://127.0.0.1:${port}/${token}`,
    release: () => files.delete(token),
  };
}

module.exports = { acquireFtpProxy, parseRange };
