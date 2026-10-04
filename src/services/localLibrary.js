'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { VIDEO_EXTENSIONS } = require('./scanner');

const videoExtensions = new Set(VIDEO_EXTENSIONS);

function isLocalAbsolutePath(value) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  if (process.platform === 'win32') return /^[A-Za-z]:[\\/]/.test(value);
  return path.isAbsolute(value);
}

async function resolveLocalPath(value) {
  if (!isLocalAbsolutePath(value)) throw new Error('Choose an absolute local path');
  return fs.promises.realpath(value);
}

async function localLocations() {
  const home = os.homedir();
  const candidates = [
    ['Home', home],
    ...['Videos', 'Downloads', 'Desktop', 'Documents', 'Pictures'].map(name => [name, path.join(home, name)]),
  ];
  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) candidates.push([drive, drive]);
    }
  } else {
    candidates.push(['Filesystem', '/']);
  }
  const locations = [];
  for (const [name, location] of candidates) {
    try {
      if ((await fs.promises.stat(location)).isDirectory()) locations.push({ name, path: location });
    } catch { /* Missing shortcuts are omitted. */ }
  }
  return locations;
}

async function browseLocal(pathValue) {
  const directory = await resolveLocalPath(pathValue);
  if (!(await fs.promises.stat(directory)).isDirectory()) throw new Error('Choose a folder');
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const directories = [];
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) directories.push({ name: entry.name, path: path.join(directory, entry.name) });
    else if (entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push({ name: entry.name, path: path.join(directory, entry.name) });
    }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { path: directory, parent: path.dirname(directory) === directory ? null : path.dirname(directory), directories, files };
}

async function validateLocalSelection(pathValue, kind) {
  const resolved = await resolveLocalPath(pathValue);
  const stat = await fs.promises.stat(resolved);
  if (kind === 'folder' && stat.isDirectory()) return resolved;
  if (kind === 'file' && stat.isFile() && videoExtensions.has(path.extname(resolved).toLowerCase())) return resolved;
  throw new Error(kind === 'file' ? 'Choose a supported video file' : 'Choose a folder');
}

module.exports = { isLocalAbsolutePath, localLocations, browseLocal, validateLocalSelection };
