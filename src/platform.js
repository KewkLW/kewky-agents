/**
 * platform.js — Cross-platform detection (WSL, SSH remote hosts)
 */

const { execSync } = require('child_process');

/**
 * Detect WSL availability on Windows.
 * @returns {{ available: boolean, distros: string[] }}
 */
function detectWSL() {
  if (process.platform !== 'win32') {
    return { available: false, distros: [] };
  }

  try {
    const raw = execSync('wsl --list --quiet', {
      encoding: 'utf16le',
      timeout: 5000,
      windowsHide: true
    });
    const distros = raw
      .split(/\r?\n/)
      .map(l => l.replace(/\0/g, '').trim())
      .filter(Boolean);
    return { available: distros.length > 0, distros };
  } catch {
    return { available: false, distros: [] };
  }
}

/**
 * Convert a Windows path to a WSL mount path.
 * e.g. F:\project -> /mnt/f/project
 * @param {string} winPath
 * @returns {string}
 */
function wslPathTranslate(winPath) {
  if (!winPath || typeof winPath !== 'string') return winPath;
  const match = winPath.match(/^([A-Za-z]):[\\\/](.*)/);
  if (!match) return winPath;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

/**
 * Parse REMOTE_HOST_* env vars into remote host configs.
 * Format: REMOTE_HOST_<NAME>=user@host:port
 * @returns {Object.<string, { user: string, host: string, port: number }>}
 */
function getRemoteHosts() {
  const hosts = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (!key.startsWith('REMOTE_HOST_') || !val) continue;
    const name = key.slice('REMOTE_HOST_'.length).toLowerCase();
    const match = val.match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
    if (match) {
      hosts[name] = {
        user: match[1],
        host: match[2],
        port: parseInt(match[3] || '22', 10)
      };
    }
  }
  return hosts;
}

module.exports = { detectWSL, wslPathTranslate, getRemoteHosts };
