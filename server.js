const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const { PORT, POLL_INTERVAL, TAILSCALE_HOST, WSL_DISTRO, USER_HOME, AGENTS, PRESETS } = require('./src/config');
const tmux = require('./src/tmux');
const { parseSessionInfo } = require('./src/detect');
const { detectWorktree } = require('./src/worktree');
const research = require('./src/research');
const comms = require('./src/comms');
const { runDistributor } = require('./src/auto-distribute');
const { checkAndNudge } = require('./src/auto-nudge');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false }));

// Debug log buffer
const debugLogs = [];
const MAX_DEBUG_LOGS = 200;

app.get('/api/config', (req, res) => {
  const agentDetails = {};
  for (const [name, cfg] of Object.entries(AGENTS)) {
    agentDetails[name] = { model: cfg.model, type: cfg.type };
  }
  res.json({ presets: PRESETS, agents: Object.keys(AGENTS), agentDetails, tailscaleHost: TAILSCALE_HOST });
});

// Team lead API — get all agent statuses
app.get('/api/team/status', (req, res) => {
  res.json({
    sessions: previousState,
    timestamp: Date.now()
  });
});

// Team lead API — send message to a specific agent session
app.post('/api/team/send', async (req, res) => {
  const { session, message } = req.body;
  if (!session || !message) {
    return res.status(400).json({ error: 'session and message required' });
  }
  const ok = await tmux.sendKeys(session, message);
  if (ok) {
    console.log(`// TEAM_LEAD_SEND: ${session} <- ${message.slice(0, 60)}...`);
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: `Failed to send to ${session}` });
  }
});

// Team lead API — get output from a specific session
app.get('/api/team/output/:session', async (req, res) => {
  const lines = await tmux.capturePane(req.params.session, parseInt(req.query.lines) || 50);
  res.json({ session: req.params.session, lines });
});

// Team lead API — launch an agent
app.post('/api/team/launch', async (req, res) => {
  const { agent, role, workdir, sessionName, flags, initMessage } = req.body;
  const agentConfig = AGENTS[agent];
  if (!agentConfig) {
    return res.status(400).json({ error: `Unknown agent: ${agent}` });
  }
  const name = sessionName || `${role || 'agent'}-${agent}-${Date.now().toString(36).slice(-4)}`;
  const dir = workdir || USER_HOME;
  let launchCmd = agentConfig.launchCmd;
  if (flags) launchCmd += ' ' + flags;
  if (agentConfig.env) {
    const envPrefix = Object.entries(agentConfig.env)
      .map(([k, v]) => `set ${k}=${v}&&`)
      .join(' ');
    launchCmd = envPrefix + ' ' + launchCmd;
  }
  const ok = await tmux.createSession(name, dir, launchCmd);
  if (ok) {
    console.log(`// TEAM_LEAD_LAUNCH: ${name} [${agent}/${role}]`);
    if (agentConfig.postLaunch) {
      setTimeout(() => tmux.sendSpecialKey(name, agentConfig.postLaunch), 3000);
    }
    // If team lead wants to send an initial message after launch
    if (initMessage) {
      const waitAndSend = async () => {
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const paneLines = await tmux.capturePane(name, 10);
          if (agentConfig.readyIndicator && agentConfig.readyIndicator.test(paneLines.join('\n'))) {
            await tmux.sendKeys(name, initMessage);
            console.log(`// TEAM_LEAD_INIT_MSG: ${name}`);
            return;
          }
        }
      };
      waitAndSend();
    }
    setTimeout(pollAndBroadcast, 1500);
    res.json({ ok: true, session: name, agent, role });
  } else {
    res.status(500).json({ error: `Failed to launch ${name}` });
  }
});

// Team lead API — kill an agent
app.post('/api/team/kill', async (req, res) => {
  const { session } = req.body;
  const ok = await tmux.killSession(session);
  if (ok) {
    console.log(`// TEAM_LEAD_KILL: ${session}`);
    setTimeout(pollAndBroadcast, 500);
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: `Failed to kill ${session}` });
  }
});

app.post('/api/debug', (req, res) => {
  const { level, message, data, timestamp, source } = req.body;
  const entry = { level, message, data, timestamp: timestamp || Date.now(), source: source || 'client' };
  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
  if (level === 'error') console.error(`// CLIENT_ERROR: ${message}`, data || '');
  res.json({ ok: true });
});

app.get('/api/debug', (req, res) => {
  res.json(debugLogs);
});

app.get('/debug', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>DEBUG // AGENT_DASHBOARD</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { background: #111; color: #ccc; font-family: monospace; font-size: 12px; margin: 0; padding: 8px; }
  .entry { border-bottom: 1px solid #333; padding: 4px 0; }
  .error { color: #f44; } .warn { color: #fa0; } .info { color: #4af; } .log { color: #aaa; }
  .ts { color: #666; margin-right: 8px; }
  .data { color: #888; font-size: 11px; }
  h1 { color: #4A8B94; font-size: 14px; margin: 8px 0; }
  #logs { max-height: 90vh; overflow-y: auto; }
  .controls { margin-bottom: 8px; }
  .controls button { background: #333; color: #ccc; border: 1px solid #555; padding: 4px 12px; cursor: pointer; font-family: monospace; }
</style></head><body>
<h1>// DEBUG_LOG // AGENT_DASHBOARD</h1>
<div class="controls">
  <button onclick="refresh()">REFRESH</button>
  <button onclick="clearLogs()">CLEAR</button>
  <button onclick="toggleAuto()">AUTO: OFF</button>
</div>
<div id="logs"></div>
<script>
let autoRefresh = null;
function refresh() {
  fetch('/api/debug').then(r=>r.json()).then(logs => {
    const el = document.getElementById('logs');
    el.innerHTML = logs.reverse().map(l => {
      const t = new Date(l.timestamp).toLocaleTimeString();
      const cls = l.level || 'log';
      const data = l.data ? '<div class="data">' + JSON.stringify(l.data).slice(0,200) + '</div>' : '';
      return '<div class="entry ' + cls + '"><span class="ts">' + t + '</span>[' + cls.toUpperCase() + '] ' + l.message + data + '</div>';
    }).join('');
  });
}
function clearLogs() { fetch('/api/debug', {method:'DELETE'}).then(refresh); }
function toggleAuto() {
  const btn = event.target;
  if (autoRefresh) { clearInterval(autoRefresh); autoRefresh = null; btn.textContent = 'AUTO: OFF'; }
  else { autoRefresh = setInterval(refresh, 1000); btn.textContent = 'AUTO: ON'; }
}
refresh();
</script></body></html>`);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const ptyWss = new WebSocketServer({ noServer: true });

// Route WebSocket upgrades: /pty goes to PTY bridge, everything else to dashboard
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/pty') {
    ptyWss.handleUpgrade(req, socket, head, (ws) => {
      ptyWss.emit('connection', ws, req);
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

// PTY bridge — spawns wsl tmux attach and bridges I/O over WebSocket
const pty = require('node-pty');
ptyWss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const session = url.searchParams.get('session');
  const cols = parseInt(url.searchParams.get('cols')) || 80;
  const rows = parseInt(url.searchParams.get('rows')) || 24;

  if (!session) {
    ws.close(1008, 'Missing session parameter');
    return;
  }

  console.log(`// PTY_CONNECT: ${session} (${cols}x${rows})`);

  // Spawn wsl tmux attach
  const shell = pty.spawn('wsl.exe', ['-d', WSL_DISTRO, '--', 'tmux', 'attach-session', '-t', session], {
    name: 'xterm-256color',
    cols,
    rows,
    env: process.env
  });

  // PTY stdout → WebSocket
  shell.onData(data => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(data);
    }
  });

  shell.onExit(({ exitCode }) => {
    console.log(`// PTY_EXIT: ${session} (code ${exitCode})`);
    if (ws.readyState === 1) ws.close();
  });

  // WebSocket → PTY stdin
  ws.on('message', (msg) => {
    const str = msg.toString();
    // Check for resize command
    try {
      const parsed = JSON.parse(str);
      if (parsed.type === 'resize') {
        shell.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {}
    // Regular input
    shell.write(str);
  });

  ws.on('close', () => {
    console.log(`// PTY_DISCONNECT: ${session}`);
    shell.kill();
  });
});

let previousState = [];
let polling = false;
const clientSubscriptions = new Map();

wss.on('connection', (ws) => {
  console.log('// CLIENT_CONNECTED');
  clientSubscriptions.set(ws, new Map());

  // Always send state on connect (even if empty — triggers empty state UI)
  ws.send(JSON.stringify({ type: 'config', tailscaleHost: TAILSCALE_HOST, port: PORT }));
  ws.send(JSON.stringify({ type: 'state', sessions: previousState }));
  ws.send(JSON.stringify({ type: 'research_state', missions: research.getMissions() }));

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
    case 'raw_input': handleRawInput(ws, msg); break;
    case 'attach': handleAttach(ws, msg); break;
    case 'subscribe': handleSubscribe(ws, msg); break;
    case 'research': handleResearch(ws, msg); break;
    case 'kill_mission': handleKillMission(ws, msg); break;
    case 'get_report': handleGetReport(ws, msg); break;
    case 'team_brief': handleTeamBrief(ws, msg); break;
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
  const dir = workdir || USER_HOME;

  // Build launch command with env vars if needed
  let launchCmd = agentConfig.launchCmd;
  if (flags) launchCmd += ' ' + flags;
  if (agentConfig.env) {
    const envPrefix = Object.entries(agentConfig.env)
      .map(([k, v]) => `set ${k}=${v}&&`)
      .join(' ');
    launchCmd = envPrefix + ' ' + launchCmd;
  }

  const ok = await tmux.createSession(name, dir, launchCmd);

  if (ok && agentConfig.postLaunch) {
    setTimeout(async () => {
      await tmux.sendSpecialKey(name, agentConfig.postLaunch);
    }, 3000);
  }

  // Team lead: send init prompt after CLI is ready
  if (ok && agentConfig.initPrompt) {
    const waitForReady = async (retries = 20) => {
      for (let i = 0; i < retries; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const paneLines = await tmux.capturePane(name, 10);
        const paneText = paneLines.join('\n');
        if (agentConfig.readyIndicator && agentConfig.readyIndicator.test(paneText)) {
          console.log(`// TEAM_LEAD_READY: ${name} (after ${(i+1)*2}s)`);
          // Feed the init prompt + current team status
          const statusSummary = previousState.length > 0
            ? '\n\nCurrent active sessions:\n' + previousState.map(s => `- ${s.name}: ${s.status}`).join('\n')
            : '\n\nNo other agents currently active.';
          await tmux.sendKeys(name, agentConfig.initPrompt + statusSummary);
          return;
        }
      }
      console.log(`// TEAM_LEAD_TIMEOUT: ${name} — CLI never became ready`);
    };
    waitForReady();
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

function handleRawInput(ws, msg) {
  const { session, data } = msg;
  if (!session || !data) return;
  // Send raw characters/escape sequences directly to tmux pane
  const escaped = data.replace(/'/g, "'\\''").replace(/\\/g, '\\\\');
  const { exec } = require('child_process');
  // Use send-keys -l for literal text, but handle special keys separately
  if (data === '\r' || data === '\n') {
    exec(`wsl -d ${WSL_DISTRO} bash -c "tmux send-keys -t '${session.replace(/'/g, "'\\''")}' Enter"`, { windowsHide: true });
  } else if (data === '\x7f' || data === '\b') {
    exec(`wsl -d ${WSL_DISTRO} bash -c "tmux send-keys -t '${session.replace(/'/g, "'\\''")}' BSpace"`, { windowsHide: true });
  } else if (data === '\x03') {
    exec(`wsl -d ${WSL_DISTRO} bash -c "tmux send-keys -t '${session.replace(/'/g, "'\\''")}' C-c"`, { windowsHide: true });
  } else if (data === '\x1b') {
    exec(`wsl -d ${WSL_DISTRO} bash -c "tmux send-keys -t '${session.replace(/'/g, "'\\''")}' Escape"`, { windowsHide: true });
  } else if (data.startsWith('\x1b[')) {
    // Arrow keys and other escape sequences
    const keyMap = { '\x1b[A': 'Up', '\x1b[B': 'Down', '\x1b[C': 'Right', '\x1b[D': 'Left' };
    const key = keyMap[data];
    if (key) {
      exec(`wsl -d ${WSL_DISTRO} bash -c "tmux send-keys -t '${session.replace(/'/g, "'\\''")}' ${key}"`, { windowsHide: true });
    }
  } else {
    // Regular text — send literally
    exec(`wsl -d ${WSL_DISTRO} bash -c "tmux send-keys -t '${session.replace(/'/g, "'\\''")}' -l '${escaped}'"`, { windowsHide: true });
  }
}

function handleAttach(ws, msg) {
  const { session } = msg;
  if (!session) return;
  const escaped = session.replace(/'/g, "''");
  // Open Windows Terminal tab with WSL tmux attach
  const cmd = `wt -w 0 new-tab --title "${escaped}" -- wsl -d ${WSL_DISTRO} tmux attach-session -t '${escaped}'`;
  require('child_process').exec(cmd, { windowsHide: false, shell: 'cmd.exe' });
  ws.send(JSON.stringify({ type: 'event', event: 'session_attached', data: { session } }));
  console.log(`// ATTACH_WT: ${session}`);
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

async function handleResearch(ws, msg) {
  const { topic, scope, focus, ignore, returnFormat, agents } = msg;

  if (!topic || !agents || agents.length === 0) {
    ws.send(JSON.stringify({ type: 'event', event: 'error', data: { message: 'Topic and at least one agent required' } }));
    return;
  }

  console.log(`// RESEARCH_DEPLOYED: "${topic}" → [${agents.join(', ')}]`);
  const mission = await research.createMission({ topic, scope, focus, ignore, returnFormat, agents });
  broadcast({ type: 'event', event: 'research_deployed', data: { id: mission.id, topic: mission.topic, agents } });
  broadcast({ type: 'research_state', missions: research.getMissions() });
}

async function handleKillMission(ws, msg) {
  const { missionId } = msg;
  const ok = await research.killMission(missionId);
  if (ok) {
    console.log(`// RESEARCH_KILLED: ${missionId}`);
    broadcast({ type: 'event', event: 'mission_killed', data: { missionId } });
  } else {
    ws.send(JSON.stringify({ type: 'event', event: 'error', data: { message: `Failed to kill mission ${missionId}` } }));
  }
  broadcast({ type: 'research_state', missions: research.getMissions() });
}

function handleGetReport(ws, msg) {
  const { missionId, slug } = msg;
  let report = null;

  if (missionId) {
    report = research.getReport(missionId);
  } else if (slug) {
    report = research.getReportFromDisk(slug);
  }

  if (report) {
    ws.send(JSON.stringify({ type: 'report', report }));
  } else {
    ws.send(JSON.stringify({ type: 'event', event: 'error', data: { message: 'Report not found' } }));
  }
}

async function handleTeamBrief(ws, msg) {
  const { objective, workdir } = msg;
  if (!objective) {
    ws.send(JSON.stringify({ type: 'event', event: 'error', data: { message: 'Objective required' } }));
    return;
  }

  // Find or launch team lead session
  const leadSessions = previousState.filter(s => s.name.includes('team-lead'));
  let leadSession = leadSessions.length > 0 ? leadSessions[0].name : null;

  if (!leadSession) {
    // Auto-launch team lead
    const agentConfig = AGENTS['team-lead'];
    leadSession = `team-lead-${Date.now().toString(36).slice(-4)}`;
    const dir = workdir || USER_HOME;
    const ok = await tmux.createSession(leadSession, dir, agentConfig.launchCmd);
    if (!ok) {
      ws.send(JSON.stringify({ type: 'event', event: 'error', data: { message: 'Failed to launch team lead' } }));
      return;
    }
    console.log(`// TEAM_LEAD_AUTO_LAUNCHED: ${leadSession}`);

    // Wait for ready
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const paneLines = await tmux.capturePane(leadSession, 10);
      if (agentConfig.readyIndicator.test(paneLines.join('\n'))) break;
    }
    // Send init prompt
    await tmux.sendKeys(leadSession, agentConfig.initPrompt);
    await new Promise(r => setTimeout(r, 5000)); // Let it process
  }

  // Build the brief with current team status
  const statusLines = previousState
    .filter(s => s.name !== leadSession)
    .map(s => `  - ${s.name}: ${s.status}`)
    .join('\n');

  const brief = `MISSION BRIEFING:
${objective}

CURRENT TEAM STATUS:
${statusLines || '  No other agents active — launch what you need via the team API.'}

Available API endpoints (curl from your terminal):
  GET  http://localhost:${PORT}/api/team/status — all agent statuses
  POST http://localhost:${PORT}/api/team/launch — launch agent {"agent":"sonnet","role":"builder","initMessage":"..."}
  POST http://localhost:${PORT}/api/team/send — send to agent {"session":"name","message":"..."}
  GET  http://localhost:${PORT}/api/team/output/:session — read agent output
  POST http://localhost:${PORT}/api/team/kill — kill agent {"session":"name"}

Decompose this objective into tasks and coordinate the team. Go.`;

  await tmux.sendKeys(leadSession, brief);
  console.log(`// TEAM_BRIEF_SENT: ${leadSession} <- ${objective.slice(0, 60)}...`);
  broadcast({ type: 'event', event: 'team_briefed', data: { session: leadSession, objective } });
  setTimeout(pollAndBroadcast, 2000);
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

    // Poll research missions for completion
    research.pollMissions();
    broadcast({ type: 'research_state', missions: research.getMissions() });

    // Auto-nudge idle agents
    checkAndNudge(sessions);

    // Auto-distribute ready tasks
    const distResult = runDistributor();
    if (distResult && distResult.assignments && distResult.assignments.length > 0) {
      broadcast({ type: 'event', event: 'tasks_distributed', data: distResult });
    }

    // Poll team comms
    const teamComms = comms.getAllComms();
    if (teamComms.teams.length > 0) {
      broadcast({ type: 'comms', comms: teamComms });
    }
    // Toast new messages
    for (const msg of teamComms.newMessages) {
      broadcast({ type: 'event', event: 'team_message', data: msg });
    }

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
  console.log(`// RESEARCH_DIR: ${research.RESEARCH_DIR}`);
  console.log(`// OPEN: http://localhost:${PORT}`);
  pollAndBroadcast();
});

process.on('SIGINT', () => {
  console.log('\n// SHUTDOWN_INITIATED');
  wss.close();
  server.close();
  process.exit(0);
});
