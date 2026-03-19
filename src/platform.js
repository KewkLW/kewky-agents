/**
 * platform.js — Cross-platform detection (WSL, SSH remote hosts)
 *
 * Supported platforms:
 *   Local:  win32 (Windows), darwin (macOS), linux
 *   Remote: windows, macos, linux (specified per REMOTE_HOST)
 *   WSL:    Windows Subsystem for Linux (win32 only)
 */

const { execSync } = require('child_process');
const os = require('os');

/**
 * Detect the local platform and basic system info.
 * @returns {{ os: string, arch: string, hostname: string, shell: string }}
 */
function detectLocalPlatform() {
  const platform = process.platform; // win32, darwin, linux
  const prettyOS = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
  return {
    os: prettyOS,
    nodePlatform: platform,
    arch: process.arch,
    hostname: os.hostname(),
    shell: platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/sh'),
    homedir: os.homedir()
  };
}

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
 * Build the remote shell command wrapper based on target OS.
 * - windows: cmd /c "command"  (Windows OpenSSH defaults to cmd.exe)
 * - macos:   bash -l -c 'command'  (loads .bash_profile for brew PATH etc.)
 * - linux:   bash -l -c 'command'  (loads profile for nvm/pyenv etc.)
 *
 * @param {string} command - The CLI command to run
 * @param {string} targetOS - 'windows', 'macos', or 'linux'
 * @returns {string} Wrapped command string for SSH
 */
function wrapRemoteCommand(command, targetOS) {
  if (targetOS === 'windows') {
    // Windows OpenSSH uses cmd.exe by default — pass command directly
    // Double quotes around the command for cmd.exe compatibility
    return command;
  }
  // macOS and Linux: wrap in login bash for PATH resolution
  // Single-quote escape: replace ' with '\''
  const escaped = command.replace(/'/g, "'\\''");
  if (targetOS === 'macos') {
    // macOS with Homebrew: ensure brew shellenv is loaded
    return `bash -l -c 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"; ${escaped}'`;
  }
  // Linux
  return `bash -l -c '${escaped}'`;
}

/**
 * Parse REMOTE_HOST_* env vars into remote host configs.
 *
 * Format: REMOTE_HOST_<NAME>=user@host:port:os
 *   - port defaults to 22
 *   - os defaults to 'linux', can be 'windows', 'macos', or 'linux'
 *
 * Examples:
 *   REMOTE_HOST_PC=kewkd@192.168.1.10:22:windows
 *   REMOTE_HOST_MAC=user@macbook.local:22:macos
 *   REMOTE_HOST_PI=pi@raspberrypi.local           (defaults to port 22, os linux)
 *   REMOTE_HOST_SERVER=deploy@10.0.0.50:2222       (defaults to os linux)
 *
 * @returns {Object.<string, { user: string, host: string, port: number, os: string }>}
 */
function getRemoteHosts() {
  const VALID_OS = ['windows', 'macos', 'linux'];
  const hosts = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (!key.startsWith('REMOTE_HOST_') || !val) continue;
    const name = key.slice('REMOTE_HOST_'.length).toLowerCase();
    // Parse: user@host[:port][:os]
    const match = val.match(/^([^@]+)@([^:]+)(?::(\d+))?(?::(\w+))?$/);
    if (match) {
      const detectedOS = match[4] ? match[4].toLowerCase() : 'linux';
      hosts[name] = {
        user: match[1],
        host: match[2],
        port: parseInt(match[3] || '22', 10),
        os: VALID_OS.includes(detectedOS) ? detectedOS : 'linux'
      };
    }
  }
  return hosts;
}

module.exports = { detectLocalPlatform, detectWSL, wslPathTranslate, wrapRemoteCommand, getRemoteHosts };
