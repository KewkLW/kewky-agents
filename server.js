const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const { PORT, POLL_INTERVAL, TAILSCALE_HOST, AGENTS, PRESETS } = require('./src/config');
const tmux = require('./src/tmux');
const { parseSessionInfo } = require('./src/detect');
const { detectWorktree } = require('./src/worktree');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ presets: PRESETS, agents: Object.keys(AGENTS), tailscaleHost: TAILSCALE_HOST });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let previousState = [];
let polling = false;
const clientSubscriptions = new Map();

wss.on('connection', (ws) => {
  console.log('// CLIENT_CONNECTED');
  clientSubscriptions.set(ws, new Map());

  // Always send state on connect (even if empty — triggers empty state UI)
  ws.send(JSON.stringify({ type: 'state', sessions: previousState }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleClientMessage(ws, msg);
  });

  ws.on('close', () => {
    clientSubscriptions.delete(ws);
    console.log('// CLIENT_DISCONNECTED');
  });
});

function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'launch': handleLaunch(ws, msg); break;
    case 'kill': handleKill(ws, msg); break;
    case 'send': handleSend(ws, msg); break;
    case 'subscribe': handleSubscribe(ws, msg); break;
  }
}

async function handleLaunch(ws, msg) {
  const { agent, role, workdir, sessionName, flags } = msg;
  const agentConfig = AGENTS[agent];
  if (!agentConfig) {
    ws.send(JSON.stringify({ type: 'event', event: 'error', data: { message: `Unknown agent: ${agent}` } }));
    return;
  }

  const name = sessionName || `${role || 'agent'}-${agent}-${Date.now().toString(36).slice(-4)}`;
  const dir = workdir || '/mnt/c/Users/kewkd';

  let launchCmd = agentConfig.launchCmd;
  if (flags) launchCmd += ' ' + flags;

  const ok = await tmux.createSession(name, dir, launchCmd);

  if (ok && agentConfig.postLaunch) {
    setTimeout(async () => {
      await tmux.sendSpecialKey(name, agentConfig.postLaunch);
    }, 3000);
  }

  const event = ok ? 'session_created' : 'error';
  const data = ok ? { session: name, agent, role } : { message: `Failed to create session ${name}` };
  broadcast({ type: 'event', event, data });

  if (ok) {
    console.log(`// SESSION_CREATED: ${name} [${agent}/${role}]`);
    setTimeout(pollAndBroadcast, 1500);
  }
}

async function handleKill(ws, msg) {
  const { session } = msg;
  const ok = await tmux.killSession(session);
  const event = ok ? 'session_killed' : 'error';
  const data = ok ? { session } : { message: `Failed to kill session ${session}` };
  broadcast({ type: 'event', event, data });

  if (ok) {
    console.log(`// SESSION_KILLED: ${session}`);
    setTimeout(pollAndBroadcast, 500);
  }
}

async function handleSend(ws, msg) {
  const { session, text } = msg;
  if (!text || !session) return;
  const ok = await tmux.sendKeys(session, text);
  if (!ok) {
    ws.send(JSON.stringify({ type: 'event', event: 'error', data: { message: `Failed to send to ${session}` } }));
  }
}

function handleSubscribe(ws, msg) {
  const { session, mode } = msg;
  const subs = clientSubscriptions.get(ws);
  if (!subs) return;

  if (mode === 'off') {
    subs.delete(session);
  } else {
    subs.set(session, mode);
  }
}

async function pollAndBroadcast() {
  if (polling) return;
  polling = true;

  try {
    const rawSessions = await tmux.listSessions();
    const sessions = [];

    for (const raw of rawSessions) {
      const paneLines = await tmux.capturePane(raw.name, 30);
      const info = parseSessionInfo(raw, paneLines, TAILSCALE_HOST);
      const worktree = await detectWorktree(raw.workdir);
      if (worktree) info.worktree = worktree;
      sessions.push(info);
    }

    previousState = sessions;
    broadcast({ type: 'state', sessions });

    // Send output to subscribed clients
    for (const [ws, subs] of clientSubscriptions) {
      for (const [sessionName, mode] of subs) {
        if (mode === 'tail' || mode === 'full') {
          const lines = await tmux.capturePane(sessionName, mode === 'full' ? 200 : 30);
          if (lines.length > 0) {
            safeSend(ws, { type: 'output', session: sessionName, lines });
          }
        }
      }
    }
  } catch (err) {
    console.error('// POLL_ERROR:', err.message);
  } finally {
    polling = false;
  }
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    safeSend(client, data);
  }
}

function safeSend(ws, msg) {
  if (ws.readyState === 1) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    ws.send(data);
  }
}

setInterval(pollAndBroadcast, POLL_INTERVAL);

server.listen(PORT, () => {
  console.log(`// AGENT_DASHBOARD_ONLINE // PORT ${PORT}`);
  console.log(`// POLL_INTERVAL: ${POLL_INTERVAL}ms`);
  console.log(`// TAILSCALE_HOST: ${TAILSCALE_HOST}`);
  console.log(`// OPEN: http://localhost:${PORT}`);
  // Don't block startup with initial poll — let it happen async
  pollAndBroadcast();
});

process.on('SIGINT', () => {
  console.log('\n// SHUTDOWN_INITIATED');
  wss.close();
  server.close();
  process.exit(0);
});
