/**
 * sessions.js — node-pty session manager
 * Replaces tmux+WSL with direct pty spawning.
 * Sessions do NOT survive server restart.
 */

const pty = require('node-pty');
const os = require('os');

const sessions = new Map();

const RING_BUFFER_LINES = 200;
const RAW_BUFFER_SIZE = 64 * 1024;

// ANSI escape stripper for status detection
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/\x1b\[[\?]?[0-9;]*[hlm]/g, '');
}

function getShell() {
  if (process.platform === 'win32') return 'cmd.exe';
  return process.env.SHELL || '/bin/sh';
}

function getShellArgs(command) {
  if (process.platform === 'win32') return ['/c', command];
  return ['-c', command];
}

/**
 * Create a new pty session.
 * @param {string} name - Unique session name
 * @param {string} command - The command to run
 * @param {object} opts - { cwd, env, cols, rows }
 * @returns {boolean} true if created
 */
function create(name, command, opts = {}) {
  if (sessions.has(name)) {
    kill(name);
  }

  const shell = getShell();
  const args = getShellArgs(command);
  const cols = opts.cols || 120;
  const rows = opts.rows || 30;

  // Merge env: process.env as base, then opts.env overrides
  const env = { ...process.env, ...(opts.env || {}) };

  try {
    const handle = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd || os.homedir(),
      env
    });

    const session = {
      handle,
      name,
      command,
      ringBuffer: [],       // ANSI-stripped lines for status detection
      rawBuffer: '',         // Raw output for xterm replay
      createdAt: Date.now(),
      subscribers: new Set(), // callback functions
      cwd: opts.cwd || os.homedir()
    };

    handle.onData((data) => {
      // Append to raw buffer (capped)
      session.rawBuffer += data;
      if (session.rawBuffer.length > RAW_BUFFER_SIZE) {
        session.rawBuffer = session.rawBuffer.slice(-RAW_BUFFER_SIZE);
      }

      // Append to ring buffer (ANSI-stripped, line-split)
      const stripped = stripAnsi(data);
      const lines = stripped.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i === 0 && session.ringBuffer.length > 0) {
          // First fragment appends to current last line
          session.ringBuffer[session.ringBuffer.length - 1] += lines[i];
        } else {
          session.ringBuffer.push(lines[i]);
        }
      }
      // Cap ring buffer
      if (session.ringBuffer.length > RING_BUFFER_LINES) {
        session.ringBuffer = session.ringBuffer.slice(-RING_BUFFER_LINES);
      }

      // Notify subscribers
      for (const cb of session.subscribers) {
        try { cb(data); } catch {}
      }
    });

    handle.onExit(({ exitCode }) => {
      console.log(`// SESSION_EXIT: ${name} (code ${exitCode})`);
      sessions.delete(name);
    });

    sessions.set(name, session);
    return true;
  } catch (err) {
    console.error(`// SESSION_SPAWN_FAIL: ${name}:`, err.message);
    return false;
  }
}

/**
 * Kill a session.
 */
function kill(name) {
  const session = sessions.get(name);
  if (!session) return false;
  try {
    session.handle.kill();
  } catch {}
  sessions.delete(name);
  return true;
}

/**
 * List all sessions with metadata.
 */
function list() {
  const result = [];
  for (const [name, session] of sessions) {
    result.push({
      name,
      created: session.createdAt,
      attached: session.subscribers.size > 0,
      workdir: session.cwd
    });
  }
  return result;
}

/**
 * Get ANSI-stripped output lines (synchronous).
 */
function getOutput(name, lineCount = 30) {
  const session = sessions.get(name);
  if (!session) return [];
  return session.ringBuffer.slice(-lineCount);
}

/**
 * Get full raw buffer for xterm replay.
 */
function getRawOutput(name) {
  const session = sessions.get(name);
  if (!session) return '';
  return session.rawBuffer;
}

/**
 * Write data to the session's pty.
 */
function write(name, data) {
  const session = sessions.get(name);
  if (!session) return false;
  session.handle.write(data);
  return true;
}

/**
 * Resize the session's pty.
 */
function resize(name, cols, rows) {
  const session = sessions.get(name);
  if (!session) return false;
  session.handle.resize(cols, rows);
  return true;
}

/**
 * Subscribe to session output. Returns unsubscribe function.
 */
function onData(name, cb) {
  const session = sessions.get(name);
  if (!session) return () => {};
  session.subscribers.add(cb);
  return () => session.subscribers.delete(cb);
}

/**
 * Check if a session exists.
 */
function has(name) {
  return sessions.has(name);
}

module.exports = {
  create,
  kill,
  list,
  getOutput,
  getRawOutput,
  write,
  resize,
  onData,
  has
};
