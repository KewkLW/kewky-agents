const { exec } = require('child_process');
const { WSL_DISTRO, USER_HOME } = require('./config');

function wslExec(cmd, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = exec(`wsl -d ${WSL_DISTRO} bash -c ${JSON.stringify(cmd)}`, {
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true
    }, (err, stdout) => {
      if (err) {
        if (err.killed || err.signal === 'SIGTERM') {
          console.error(`// WSL_TIMEOUT: ${cmd.slice(0, 60)}...`);
        }
        resolve(null);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function listSessions() {
  const fmt = '#{session_name}|#{session_created}|#{session_attached}|#{pane_current_path}';
  const raw = await wslExec(`tmux ls -F '${fmt}' 2>/dev/null`);
  if (!raw) return [];

  return raw.trim().split('\n').filter(Boolean).map(line => {
    const [name, created, attached, workdir] = line.split('|');
    return {
      name,
      created: parseInt(created, 10),
      attached: parseInt(attached, 10) > 0,
      workdir: workdir || ''
    };
  });
}

async function capturePane(sessionName, lines = 30) {
  const raw = await wslExec(`tmux capture-pane -t ${esc(sessionName)} -p -S -${lines} 2>/dev/null`);
  if (!raw) return [];
  return raw.split('\n');
}

async function killSession(sessionName) {
  const result = await wslExec(`tmux kill-session -t ${esc(sessionName)} 2>/dev/null`);
  return result !== null;
}

async function sendKeys(sessionName, text) {
  const escaped = text.replace(/'/g, "'\\''");
  // Send text and Enter separately with delay — TUI apps (codex, claude) need this
  const r1 = await wslExec(`tmux send-keys -t ${esc(sessionName)} '${escaped}'`);
  if (r1 === null) return false;
  await new Promise(r => setTimeout(r, 300));
  const r2 = await wslExec(`tmux send-keys -t ${esc(sessionName)} Enter`);
  return r2 !== null;
}

async function createSession(name, workdir, command) {
  // Convert Windows path to WSL path for tmux working directory
  const wslWorkdir = windowsToWslPath(workdir);

  // Ensure WSL interop is active (systemd can drop it)
  await wslExec("test -f /proc/sys/fs/binfmt_misc/WSLInterop || sudo sh -c 'echo :WSLInterop:M::MZ::/init:PF > /proc/sys/fs/binfmt_misc/register'");

  const r1 = await wslExec(`tmux new-session -d -s ${esc(name)} -c ${esc(wslWorkdir)}`);
  if (r1 === null) return false;

  if (command) {
    // Wrap Windows commands with cmd.exe /c for WSL interop
    const wslCmd = `cmd.exe /c '${command.replace(/'/g, "'\\''")}'`;
    const escaped = wslCmd.replace(/'/g, "'\\''");
    await wslExec(`tmux send-keys -t ${esc(name)} '${escaped}' Enter`);
  }
  return true;
}

async function sendSpecialKey(sessionName, key) {
  return (await wslExec(`tmux send-keys -t ${esc(sessionName)} ${key}`)) !== null;
}

function windowsToWslPath(winPath) {
  if (!winPath) return windowsToWslPath(USER_HOME);
  const normalized = winPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)/);
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
  }
  return normalized;
}

function esc(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

const TMUX_EXE = 'tmux'; // WSL tmux

module.exports = {
  listSessions,
  capturePane,
  killSession,
  sendKeys,
  createSession,
  sendSpecialKey,
  wslExec,
  windowsToWslPath,
  TMUX_EXE
};
