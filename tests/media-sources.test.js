'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ftpAccessOptions, ftpChildUrl, ftpSourceUrl } = require('../src/services/ftp');
const { parseRange } = require('../src/services/ftpProxy');

test('FTP bridge handles browser and FFmpeg byte ranges', () => {
  assert.deepEqual(parseRange('bytes=0-1023', 2048), { start: 0, end: 1023 });
  assert.deepEqual(parseRange('bytes=-100', 2048), { start: 1948, end: 2047 });
  assert.equal(parseRange('bytes=2048-', 2048), false);
});

test('FTP file URLs keep authentication and encode nested filenames', () => {
  const source = 'ftp://admin:p%40ss@192.168.1.1/Drive1_1/';
  assert.deepEqual(ftpAccessOptions(new URL(source)), {
    host: '192.168.1.1', port: 21, user: 'admin', password: 'p@ss',
  });
  const child = new URL(ftpChildUrl(source, '/Drive1_1/Action & More/Film #1.mp4'));
  assert.equal(child.username, 'admin');
  assert.equal(child.password, 'p%40ss');
  assert.equal(decodeURIComponent(child.pathname), '/Drive1_1/Action & More/Film #1.mp4');
  assert.equal(ftpAccessOptions(new URL('ftp://admin@192.168.1.1/')).password, '');
});

test('FTP source accepts a separate password and preserves its selected folder', () => {
  const source = ftpSourceUrl('ftp://admin@192.168.1.1/Drive1_1/', 'p@ss');
  assert.equal(new URL(source).pathname, '/Drive1_1/');
  assert.equal(ftpAccessOptions(new URL(source)).password, 'p@ss');
  assert.equal(ftpAccessOptions(new URL(ftpSourceUrl('ftp://admin@192.168.1.1/', 'admin'))).password, 'admin');
  assert.throws(() => ftpSourceUrl('https://192.168.1.1/'), /valid ftp/);
});

test('FTP scanner recursively discovers files and retains source credentials', async () => {
  const accessCalls = [];
  class FakeClient {
    async access(options) { accessCalls.push(options); }
    async list(dir) {
      if (dir === '/Drive1_1/') return [{ name: 'Action & More', isDirectory: true }];
      if (dir === '/Drive1_1/Action & More') {
        return [
          { name: 'Film #1.mp4', isFile: true, size: 123 },
          { name: 'notes.txt', isFile: true, size: 10 },
        ];
      }
      throw new Error(`Unexpected directory: ${dir}`);
    }
    close() {}
  }
  const { scanDirectory } = require('../src/services/scanner');
  const files = await scanDirectory('ftp://admin:p%40ss@192.168.1.1/Drive1_1/', 'ftp', () => new FakeClient());
  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, 'Film #1.mp4');
  assert.equal(files[0].fileSize, 123);
  assert.equal(new URL(files[0].filePath).password, 'p%40ss');
  assert.equal(accessCalls[0].password, 'p@ss');
});

test('selected FTP folder includes only files inside that folder', () => {
  const { isWithinSource } = require('../src/services/scanner');
  const source = { source_type: 'ftp', path: 'ftp://admin:p%40ss@192.168.1.1/Drive1_1/Movies/' };
  assert.equal(isWithinSource({ source_type: 'ftp', file_path: source.path + 'Film.mp4' }, source), true);
  assert.equal(isWithinSource({ source_type: 'ftp', file_path: 'ftp://admin:p%40ss@192.168.1.1/Drive1_1/Movies2/Film.mp4' }, source), false);
  assert.equal(isWithinSource({ source_type: 'ftp', file_path: 'ftp://admin:p%40ss@192.168.1.1/Drive1_2/Film.mp4' }, source), false);
});

test('TMDB matching uses title and year and returns poster metadata', async () => {
  const { TMDBService } = require('../src/services/tmdb');
  const calls = [];
  const request = async url => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname === '/3/search/movie') {
      return { status: 200, data: { results: [{ id: 603, title: 'The Matrix', release_date: '1999-03-31' }] } };
    }
    return { status: 200, data: {
      id: 603, title: 'The Matrix', release_date: '1999-03-31',
      genres: [{ name: 'Action' }], poster_path: '/poster.jpg',
      overview: 'A simulated world.', runtime: 136, vote_average: 8.2,
    } };
  };
  const result = await new TMDBService('test-key', request).matchMedia('The Matrix', 1999);
  assert.equal(calls[0].searchParams.get('query'), 'The Matrix');
  assert.equal(calls[0].searchParams.get('year'), '1999');
  assert.equal(result.title, 'The Matrix');
  assert.equal(result.year, 1999);
  assert.equal(result.poster_path, 'https://image.tmdb.org/t/p/w500/poster.jpg');
});

test('TMDB retries transient connection errors', async () => {
  const { TMDBService } = require('../src/services/tmdb');
  let attempts = 0;
  const service = new TMDBService('test-key', async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    return { status: 200, data: { results: [{ id: 1 }] } };
  });
  assert.equal((await service.searchMovie('Example')).length, 1);
  assert.equal(attempts, 3);
});
