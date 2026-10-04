'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb, getSetting } = require('../db/database');

const ROOT = path.resolve(process.env.DATA_DIR || './data', 'subtitles');
const MAX_BYTES = 2 * 1024 * 1024;
const API = 'https://api.opensubtitles.com/api/v1';

function toVtt(buffer, filename = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > MAX_BYTES) throw new Error('Subtitle must be 2 MB or smaller');
  let value = buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (value.includes('\uFFFD') || value.includes('\0')) throw new Error('Subtitle must be UTF-8 text');
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.srt' && ext !== '.vtt') throw new Error('Choose an .srt or .vtt subtitle');
  if (ext === '.srt') {
    value = value.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    value = `WEBVTT\n\n${value}`;
  }
  if (!value.startsWith('WEBVTT') || !/(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/.test(value)) {
    throw new Error('Subtitle contains no valid timed cues');
  }
  return value;
}

function list(mediaId) {
  return getDb().prepare('SELECT id, label, language, source FROM external_subtitles WHERE media_id = ? ORDER BY id').all(mediaId);
}

async function save(mediaId, { buffer, filename, label, language, source }) {
  const vtt = toVtt(buffer, filename);
  const safeLanguage = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language || '') ? language.toLowerCase() : 'und';
  const safeLabel = String(label || filename || 'Subtitle').trim().slice(0, 100);
  const dir = path.join(ROOT, String(mediaId));
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${crypto.randomUUID()}.vtt`);
  await fs.promises.writeFile(filePath, vtt, { flag: 'wx' });
  try {
    const result = getDb().prepare('INSERT INTO external_subtitles (media_id, label, language, source, file_path) VALUES (?, ?, ?, ?, ?)')
      .run(mediaId, safeLabel, safeLanguage, source, filePath);
    return { id: result.lastInsertRowid, label: safeLabel, language: safeLanguage, source };
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw error;
  }
}

function remove(mediaId, id) {
  const row = getDb().prepare('SELECT file_path FROM external_subtitles WHERE id = ? AND media_id = ?').get(id, mediaId);
  if (!row) return false;
  getDb().prepare('DELETE FROM external_subtitles WHERE id = ? AND media_id = ?').run(id, mediaId);
  fs.promises.unlink(row.file_path).catch(() => {});
  return true;
}

function file(mediaId, id) {
  return getDb().prepare('SELECT file_path FROM external_subtitles WHERE id = ? AND media_id = ?').get(id, mediaId)?.file_path;
}

function credentials() {
  const key = getSetting('opensubtitles_api_key');
  if (!key) throw new Error('Add your OpenSubtitles API key in Settings first');
  return { key, username: getSetting('opensubtitles_username'), password: getSetting('opensubtitles_password') };
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000), headers: {
    'Api-Key': options.key, 'User-Agent': 'DSPlix v1.0', 'Accept': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `OpenSubtitles request failed (${response.status})`);
  return body;
}

async function search({ query, tmdbId, language = 'en' }) {
  const { key } = credentials();
  const params = new URLSearchParams();
  if (tmdbId) params.set('tmdb_id', String(tmdbId));
  else params.set('query', String(query || '').slice(0, 120));
  params.set('languages', /^[a-z]{2,3}$/.test(language) ? language : 'en');
  const data = await apiFetch(`${API}/subtitles?${params}`, { key });
  return (data.data || []).slice(0, 30).map(item => ({
    id: Number(item.attributes?.files?.[0]?.file_id),
    label: item.attributes?.release || item.attributes?.feature_details?.title || 'Subtitle',
    language: item.attributes?.language || language,
    downloads: item.attributes?.download_count || 0,
  })).filter(item => Number.isInteger(item.id));
}

async function download(fileId) {
  const { key, username, password } = credentials();
  if (!username || !password) throw new Error('Add your OpenSubtitles username and password in Settings to download');
  const login = await apiFetch(`${API}/login`, { method: 'POST', key, body: JSON.stringify({ username, password }) });
  if (!login.token) throw new Error('OpenSubtitles login did not return a token');
  const returnedHost = String(login.base_url || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  const base = ['api.opensubtitles.com', 'vip-api.opensubtitles.com'].includes(returnedHost)
    ? `https://${returnedHost}/api/v1` : API;
  const response = await apiFetch(`${base}/download`, {
    method: 'POST', key, token: login.token, body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
  });
  const link = new URL(response.link);
  if (link.protocol !== 'https:' || !/(^|\.)opensubtitles\.(com|org)$/i.test(link.hostname)) {
    throw new Error('OpenSubtitles returned an unexpected download host');
  }
  const fileResponse = await fetch(link, { signal: AbortSignal.timeout(20000) });
  if (!fileResponse.ok || Number(fileResponse.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Subtitle download failed or is too large');
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('Subtitle download is too large');
  return { buffer, filename: response.file_name || 'subtitle.srt' };
}

module.exports = { toVtt, list, save, remove, file, search, download, MAX_BYTES };
