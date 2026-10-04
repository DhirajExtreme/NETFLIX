/**
 * @fileoverview FTP streaming and metadata utility.
 *
 * Provides functions to get file size and create readable streams
 * from FTP sources using basic-ftp.
 *
 * @module services/ftp
 */

const { Client } = require('basic-ftp');
const { PassThrough } = require('stream');

function ftpAccessOptions(url) {
  return {
    host: url.hostname,
    port: Number(url.port) || 21,
    user: decodeURIComponent(url.username) || 'anonymous',
    // basic-ftp otherwise substitutes its guest password for an empty password.
    password: decodeURIComponent(url.password),
  };
}

function ftpSourceUrl(sourcePath, password) {
  const url = new URL(sourcePath);
  if (url.protocol !== 'ftp:' || !url.hostname) throw new Error('Enter a valid ftp:// address');
  if (password !== undefined && password !== '') {
    if (typeof password !== 'string') throw new Error('FTP password must be text');
    url.password = password;
  }
  if (!url.pathname) url.pathname = '/';
  return url.toString();
}

function ftpChildUrl(parentUrl, remotePath) {
  const url = new URL(parentUrl);
  url.pathname = remotePath.split('/').map(encodeURIComponent).join('/');
  return url.toString();
}

async function testFtpDirectory(ftpUrl) {
  const client = new Client(10000);
  try {
    const url = new URL(ftpUrl);
    if (url.protocol !== 'ftp:') throw new Error('Expected an ftp:// URL');
    await client.access(ftpAccessOptions(url));
    await client.list(decodeURIComponent(url.pathname) || '/');
    return true;
  } finally {
    client.close();
  }
}

async function listFtpDirectories(ftpUrl) {
  const client = new Client(10000);
  try {
    const url = new URL(ftpUrl);
    await client.access(ftpAccessOptions(url));
    const entries = await client.list(decodeURIComponent(url.pathname) || '/');
    return entries.filter(entry => entry.isDirectory && entry.name !== '.' && entry.name !== '..')
      .map(entry => entry.name);
  } finally {
    client.close();
  }
}

/**
 * Get the size of an FTP file.
 * @param {string} ftpUrl - e.g. ftp://192.168.1.10/path/to/movie.mp4
 * @returns {Promise<{ size: number }>}
 */
async function getFtpFileInfo(ftpUrl) {
  const client = new Client();
  try {
    const url = new URL(ftpUrl);
    await client.access(ftpAccessOptions(url));
    const remotePath = decodeURIComponent(url.pathname);
    const size = await client.size(remotePath);
    return { size };
  } catch (err) {
    throw new Error(`Failed to get FTP file info: ${err.message}`);
  } finally {
    client.close();
  }
}

/**
 * Check if an FTP file exists.
 * @param {string} ftpUrl 
 * @returns {Promise<boolean>}
 */
async function ftpFileExists(ftpUrl) {
  try {
    await getFtpFileInfo(ftpUrl);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Creates a readable stream for an FTP file, starting at a specific byte.
 * Since FTP doesn't natively support byte ranges with an 'end' limit easily,
 * we stream from 'start' to the end of the file, and rely on the consumer
 * destroying the stream if they reach their desired end byte early.
 *
 * @param {string} ftpUrl 
 * @param {object} [options] 
 * @param {number} [options.start=0] 
 * @returns {Promise<import('stream').Readable>}
 */
async function getFtpStream(ftpUrl, options = {}) {
  const client = new Client();
  const url = new URL(ftpUrl);
  
  try {
    await client.access(ftpAccessOptions(url));
  } catch (err) {
    client.close();
    throw err;
  }

  const remotePath = decodeURIComponent(url.pathname);
  const startByte = options.start || 0;

  // Create a PassThrough stream to act as our Readable
  const passThrough = new PassThrough();

  // If the consumer destroys the stream (e.g. client disconnects), we must abort the FTP download
  passThrough.on('close', () => {
    if (!client.closed) {
      client.close();
    }
  });

  // Start the download in the background. It pipes into our passThrough.
  client.downloadTo(passThrough, remotePath, startByte)
    .then(() => {
      // Download completed naturally
      client.close();
    })
    .catch((err) => {
      // Ignore errors if the stream was intentionally destroyed by the consumer
      if (!passThrough.destroyed) {
        passThrough.destroy(err);
      }
      client.close();
    });

  return passThrough;
}

module.exports = {
  ftpAccessOptions,
  ftpSourceUrl,
  ftpChildUrl,
  testFtpDirectory,
  listFtpDirectories,
  getFtpFileInfo,
  ftpFileExists,
  getFtpStream
};
