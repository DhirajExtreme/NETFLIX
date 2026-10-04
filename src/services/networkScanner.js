/**
 * @fileoverview Network and shared drive scanner utility.
 * Scans the local subnets for active SMB (445) and FTP (21) hosts,
 * and lists mapped network drives and local SMB shares on Windows.
 * @module services/networkScanner
 */

'use strict';

const os = require('os');
const net = require('net');
const { exec } = require('child_process');

/**
 * Probe a single IP address and port to see if it is open.
 *
 * @param {string} ip - IP address to test.
 * @param {number} port - Port number (e.g. 445 for SMB, 21 for FTP).
 * @param {number} [timeout=300] - Connection timeout in milliseconds.
 * @returns {Promise<boolean>} True if the port is open and responding.
 */
function probePort(ip, port, timeout = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      status = true;
      socket.destroy();
    });

    socket.on('timeout', () => {
      socket.destroy();
    });

    socket.on('error', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      resolve(status);
    });

    socket.connect(port, ip);
  });
}

/**
 * Extract active IPv4 Class-C subnet prefixes configured on the host.
 * Ignores loopback and internal interfaces.
 *
 * @returns {string[]} Subnet prefixes (e.g. ["192.168.1", "10.0.0"])
 */
function getLocalSubnetPrefixes() {
  const interfaces = os.networkInterfaces();
  const prefixes = [];

  for (const name of Object.keys(interfaces)) {
    for (const netInterface of interfaces[name]) {
      // Check for IPv4 using string 'IPv4' or number 4 (older node versions)
      if ((netInterface.family === 'IPv4' || netInterface.family === 4) && !netInterface.internal) {
        const ip = netInterface.address;
        
        // Extract the first 3 octets to scan the /24 subnet,
        // regardless of the exact subnet mask (e.g. Wi-Fi networks sometimes have 255.255.252.0).
        const parts = ip.split('.');
        if (parts.length === 4) {
          prefixes.push(parts.slice(0, 3).join('.'));
        }
      }
    }
  }

  // De-duplicate in case of multiple interfaces in the same subnet
  return [...new Set(prefixes)];
}

/**
 * Walk an entire Class-C subnet (1-254) and probe for active SMB & FTP ports.
 *
 * @param {string} prefix - Subnet prefix (e.g., "192.168.1").
 * @returns {Promise<Array<{ ip: string, port: number, type: 'smb'|'ftp' }>>} Discovered hosts.
 */
async function scanSubnet(prefix) {
  const results = [];
  const promises = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${prefix}.${i}`;

    // Scan SMB (445)
    promises.push(
      probePort(ip, 445, 250).then((open) => {
        if (open) {
          results.push({ ip, port: 445, type: 'smb' });
        }
      })
    );

    // Scan FTP (21)
    promises.push(
      probePort(ip, 21, 250).then((open) => {
        if (open) {
          results.push({ ip, port: 21, type: 'ftp' });
        }
      })
    );
  }

  await Promise.all(promises);
  return results;
}

/**
 * Query Windows host for mapped network drives (DriveType = 4) using PowerShell.
 *
 * @returns {Promise<Array<{ name: string, path: string, type: 'mapped' }>>} Mapped network drives.
 */
function getWindowsNetworkDrives() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve([]);
    }

    const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 4 } | Select-Object DeviceID, ProviderName | ConvertTo-Json"';
    exec(cmd, (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve([]);
      }
      try {
        const drives = JSON.parse(stdout);
        const results = Array.isArray(drives) ? drives : (drives ? [drives] : []);
        resolve(
          results.map((d) => ({
            name: d.DeviceID,
            path: d.ProviderName,
            type: 'mapped'
          }))
        );
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Query Windows host for active local SMB shared folders.
 *
 * @returns {Promise<Array<{ name: string, path: string, description: string, type: 'local_share' }>>} Active shares.
 */
function getLocalShares() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve([]);
    }

    const cmd = 'powershell -NoProfile -Command "Get-SmbShare | Select-Object Name, Path, Description | ConvertTo-Json"';
    exec(cmd, (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve([]);
      }
      try {
        const shares = JSON.parse(stdout);
        const results = Array.isArray(shares) ? shares : (shares ? [shares] : []);
        resolve(
          results
            .filter((s) => s.Name && !s.Name.endsWith('$'))
            .map((s) => ({
              name: s.Name,
              path: s.Path,
              description: s.Description || '',
              type: 'local_share'
            }))
        );
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Run a full local network discovery task.
 *
 * @returns {Promise<{ networkHosts: Array<{ ip: string, port: number, type: string }>, mappedDrives: Array<{ name: string, path: string, type: string }>, localShares: Array<{ name: string, path: string, description: string, type: string }> }>}
 */
async function scanAllNetwork() {
  const prefixes = getLocalSubnetPrefixes();
  const networkHosts = [];

  for (const prefix of prefixes) {
    try {
      const hosts = await scanSubnet(prefix);
      networkHosts.push(...hosts);
    } catch (err) {
      console.error(`[networkScanner] Subnet scan error for prefix ${prefix}:`, err.message);
    }
  }

  const [drives, shares] = await Promise.all([
    getWindowsNetworkDrives(),
    getLocalShares()
  ]);

  return {
    networkHosts,
    mappedDrives: drives,
    localShares: shares
  };
}

const fs = require('fs/promises');
const ftp = require('basic-ftp');
const { ftpAccessOptions, ftpChildUrl } = require('./ftp');

/**
 * Browse a directory to list its subdirectories.
 *
 * @param {string} dirPath - The path or URL to browse.
 * @param {string} type - The source type ('local', 'smb', 'ftp').
 * @returns {Promise<Array<{ name: string, path: string, isDirectory: boolean }>>}
 */
async function browseDirectory(dirPath, type) {
  const results = [];
  try {
    if (type === 'ftp') {
      const client = new ftp.Client();
      // Parse the FTP URL. e.g. ftp://192.168.1.10/some/path
      const url = new URL(dirPath);
      const host = url.hostname;
      const port = url.port || 21;
      const remotePath = decodeURIComponent(url.pathname) || '/';

      try {
        await client.access(ftpAccessOptions(url));
        const list = await client.list(remotePath);
        for (const item of list) {
          if (item.isDirectory && item.name !== '.' && item.name !== '..') {
            // Reconstruct the full ftp URL
            const childPath = ftpChildUrl(url, `${remotePath.endsWith('/') ? remotePath : remotePath + '/'}${item.name}`);
            results.push({ name: item.name, path: childPath, isDirectory: true });
          }
        }
      } finally {
        client.close();
      }
    } else {
      // Local or SMB (Windows handles UNC paths natively)
      const normalizedStr = dirPath.replace(/\//g, '\\');
      const rootMatch = normalizedStr.match(/^\\\\([^\\]+)\\?$/);

      if (rootMatch) {
         const host = rootMatch[1];
         await new Promise((resolve) => {
            const { exec } = require('child_process');
            exec(`net view \\\\${host} /all`, (err, stdout) => {
              if (!err) {
                const lines = stdout.split('\n');
                let startParsing = false;
                for (const line of lines) {
                  if (line.startsWith('-----------------')) {
                    startParsing = true;
                    continue;
                  }
                  if (startParsing && line.trim()) {
                    if (line.includes('The command completed')) break;
                    const match = line.match(/^([^\s]+)/);
                    if (match && match[1]) {
                      results.push({
                        name: match[1],
                        path: `\\\\${host}\\${match[1]}`,
                        isDirectory: true
                      });
                    }
                  }
                }
              }
              resolve();
            });
         });
      } else {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('$')) {
            results.push({
              name: entry.name,
              path: require('path').join(dirPath, entry.name),
              isDirectory: true
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[networkScanner] Failed to browse directory:', err.message);
  }
  return results;
}

module.exports = {
  scanAllNetwork,
  getLocalSubnetPrefixes,
  browseDirectory
};
