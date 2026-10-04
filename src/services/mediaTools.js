'use strict';

function binaryPath(packageName, fallback) {
  try {
    return require(packageName) || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  ffmpeg: binaryPath('ffmpeg-static', 'ffmpeg'),
  ffprobe: binaryPath('@derhuerst/ffprobe-static', 'ffprobe'),
};
