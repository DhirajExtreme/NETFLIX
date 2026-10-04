/**
 * @fileoverview SMB / filesystem access wrapper for mounted drives and UNC paths.
 *
 * Provides convenience functions for listing directories, streaming files
 * (with HTTP range-request support), querying file metadata, and testing
 * path accessibility. All functions are UNC-path-aware and handle Windows
 * backslash conventions transparently.
 *
 * @module services/smb
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * File extensions recognised as video files (lowercase, with leading dot).
 * @type {string[]}
 */
const VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts', '.m2ts',
  '.vob', '.divx', '.asf', '.rm', '.rmvb'
];

/* -------------------------------------------------------------------------- */
/*  Internal helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Map common filesystem error codes to human-readable messages.
 *
 * @param {NodeJS.ErrnoException} err - The original filesystem error.
 * @param {string} targetPath - The path that triggered the error.
 * @returns {string} A descriptive error message.
 */
function describeError(err, targetPath) {
  switch (err.code) {
    case 'ENOENT':
      return `Path not found: ${targetPath}`;
    case 'EPERM':
      return `Permission denied: ${targetPath}`;
    case 'EACCES':
      return `Access denied (insufficient privileges): ${targetPath}`;
    case 'ENOTDIR':
      return `Not a directory: ${targetPath}`;
    case 'EISDIR':
      return `Is a directory (expected a file): ${targetPath}`;
    case 'EBUSY':
      return `Resource busy or locked: ${targetPath}`;
    case 'ENAMETOOLONG':
      return `Path name too long: ${targetPath}`;
    case 'ELOOP':
      return `Too many symbolic links encountered: ${targetPath}`;
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
      return `Network path unreachable: ${targetPath}`;
    default:
      return `Filesystem error (${err.code || 'UNKNOWN'}): ${err.message} — path: ${targetPath}`;
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * List the immediate contents of a directory.
 *
 * Works with local paths, mapped drive letters, and UNC paths
 * (e.g. `\\\\server\\share\\folder`).
 *
 * @param {string} dirPath - Absolute path to the directory.
 * @returns {Promise<Array<{ name: string, isDirectory: boolean, isFile: boolean, path: string }>>}
 *   An array of directory entries with metadata.
 * @throws {Error} Descriptive error when the path is inaccessible.
 */
async function listDirectory(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });

    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      path: path.join(dirPath, entry.name)
    }));
  } catch (err) {
    throw new Error(describeError(err, dirPath));
  }
}

/**
 * Create a readable stream for a file, optionally restricted to a byte range.
 *
 * Designed for use with HTTP range requests: pass `options.start` and
 * `options.end` to stream a specific byte slice.
 *
 * @param {string} filePath - Absolute path to the file.
 * @param {object} [options] - Stream options.
 * @param {number} [options.start] - Start byte offset (inclusive).
 * @param {number} [options.end]   - End byte offset (inclusive).
 * @returns {Promise<fs.ReadStream>} A readable file stream.
 * @throws {Error} If the file does not exist or is not readable.
 */
async function getFileStream(filePath, options) {
  // Validate file existence before creating a stream
  try {
    await fsp.access(filePath, fs.constants.R_OK);
  } catch (err) {
    throw new Error(describeError(err, filePath));
  }

  /** @type {fs.ReadStreamOptions} */
  const streamOpts = {};

  if (options && typeof options.start === 'number') {
    streamOpts.start = options.start;
  }
  if (options && typeof options.end === 'number') {
    streamOpts.end = options.end;
  }

  return fs.createReadStream(filePath, streamOpts);
}

/**
 * Retrieve metadata for a file or directory.
 *
 * @param {string} filePath - Absolute path to the target.
 * @returns {Promise<{ size: number, modified: Date, created: Date, isFile: boolean, isDirectory: boolean }>}
 *   File metadata object.
 * @throws {Error} Descriptive error when the path is inaccessible.
 */
async function getFileInfo(filePath) {
  try {
    const stats = await fsp.stat(filePath);

    return {
      size: stats.size,
      modified: stats.mtime,
      created: stats.birthtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  } catch (err) {
    throw new Error(describeError(err, filePath));
  }
}

/**
 * Check whether a file exists and is accessible.
 *
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<boolean>} `true` if the file exists and is readable.
 */
async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Determine whether a filename has a recognised video extension.
 *
 * The check is case-insensitive.
 *
 * @param {string} filename - File name or full path.
 * @returns {boolean} `true` if the extension matches a known video format.
 */
function isVideoFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Test whether a filesystem path is accessible with read permission.
 *
 * Useful for verifying that UNC paths (e.g. `\\\\server\\share\\path`) and
 * mapped network drives are reachable before attempting heavier operations.
 *
 * @param {string} dirPath - The path to test.
 * @returns {Promise<{ accessible: boolean, error: string|null }>}
 *   Result indicating accessibility and, on failure, the error message.
 */
async function testPath(dirPath) {
  try {
    await fsp.access(dirPath, fs.constants.R_OK);
    return { accessible: true, error: null };
  } catch (err) {
    return { accessible: false, error: describeError(err, dirPath) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Exports                                                                   */
/* -------------------------------------------------------------------------- */

module.exports = {
  VIDEO_EXTENSIONS,
  listDirectory,
  getFileStream,
  getFileInfo,
  fileExists,
  isVideoFile,
  testPath
};
