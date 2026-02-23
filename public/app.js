// AGENT_DASHBOARD // FRONTEND_CONTROLLER
// VECTORHEART_PROTOCOL // V1.0

const WS_URL = `ws://${location.host}`;
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;

let ws = null;
let reconnectDelay = RECONNECT_BASE;
let sessions = [];
let cardElements = {};
let outputModes = {};
let xtermInstances = {};
let pendingKill = null;

// ============================================
// WEBSOCKET
// ============================================

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    reconnectDelay = RECONNECT_BASE;
    setConnectionStatus('SYSTEM_ACTIVE', false);
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case 'state':
        handleStateUpdate(msg.sessions);
        break;
      case 'output':
        handleOutputUpdate(msg.session, msg.lines);
        break;
      case 'event':
        handleEvent(msg.event, msg.data);
        break;
    }
  };

  ws.onclose = () => {
    setConnectionStatus('RECONNECTING', true);
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = () => {};
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ============================================
// STATE MANAGEMENT
// ============================================

function handleStateUpdate(newSessions) {
  const newNames = new Set(newSessions.map(s => s.name));
  const oldNames = new Set(sessions.map(s => s.name));

  // Remove cards for dead sessions
  for (const name of oldNames) {
    if (!newNames.has(name)) {
      removeCard(name);
    }
  }

  // Update or create cards
  for (const session of newSessions) {
    if (cardElements[session.name]) {
      updateCard(session);
    } else {
      createCard(session);
    }
  }

  sessions = newSessions;
  updateSessionCount(newSessions.length);
  updateEmptyState(newSessions.length === 0);
}

function handleOutputUpdate(sessionName, lines) {
  const mode = outputModes[sessionName] || 'off';
  const card = cardElements[sessionName];
  if (!card) return;

  const outputEl = card.querySelector('.card-output');

  if (mode === 'full' && xtermInstances[sessionName]) {
    const term = xtermInstances[sessionName];
    term.clear();
    for (const line of lines) {
      term.writeln(line);
    }
  } else if (mode === 'tail') {
    const pre = outputEl.querySelector('pre');
    if (pre) {
      pre.textContent = lines.join('\n');
      outputEl.scrollTop = outputEl.scrollHeight;
    }
  }
}

function handleEvent(event, data) {
  switch (event) {
    case 'session_created':
      showToast(`SESSION_CREATED: ${data.session}`, 'success');
      break;
    case 'session_killed':
      showToast(`SESSION_TERMINATED: ${data.session}`, 'success');
      break;
    case 'error':
      showToast(`ERROR: ${data.message}`, 'error');
      break;
  }
}

// ============================================
// CARD RENDERING
// ============================================

function createCard(session) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.dataset.session = session.name;

  card.innerHTML = buildCardHTML(session);
  bindCardEvents(card, session.name);

  document.getElementById('agent-grid').appendChild(card);
  cardElements[session.name] = card;

  if (!outputModes[session.name]) {
    outputModes[session.name] = 'off';
  }
}

function updateCard(session) {
  const card = cardElements[session.name];
  if (!card) return;

  // Update status dot
  const dot = card.querySelector('.card-status-dot');
  dot.className = `card-status-dot ${session.status}`;

  // Update badges
  const agentBadge = card.querySelector('.badge-agent');
  agentBadge.textContent = session.agentType.toUpperCase();

  const roleBadge = card.querySelector('.badge-role');
  roleBadge.textContent = session.role.toUpperCase();

  // Update attached badge
  let attachedBadge = card.querySelector('.badge-attached');
  if (session.attached && !attachedBadge) {
    const header = card.querySelector('.card-header');
    attachedBadge = document.createElement('span');
    attachedBadge.className = 'card-badge badge-attached';
    attachedBadge.textContent = 'ATTACHED';
    header.appendChild(attachedBadge);
  } else if (!session.attached && attachedBadge) {
    attachedBadge.remove();
  }

  // Update info values
  updateInfoValue(card, 'uptime', session.uptime);
  updateInfoValue(card, 'workdir', session.workdir);
  updateInfoValue(card, 'status-text', session.status.toUpperCase());

  // Update worktree
  const wtRow = card.querySelector('.worktree-row');
  if (session.worktree && wtRow) {
    wtRow.classList.remove('hidden');
    updateInfoValue(card, 'worktree', `${session.worktree.branch} → ${session.worktree.path}`);
  } else if (wtRow) {
    wtRow.classList.add('hidden');
  }

  // Update SSH command
  const sshCode = card.querySelector('.ssh-code');
  if (sshCode) sshCode.textContent = session.sshCommand;

  // Update tail output if in tail mode
  if (outputModes[session.name] === 'tail' && session.lastOutput) {
    const pre = card.querySelector('.card-output pre');
    if (pre) {
      pre.textContent = session.lastOutput.join('\n');
      const outputEl = card.querySelector('.card-output');
      outputEl.scrollTop = outputEl.scrollHeight;
    }
  }
}

function updateInfoValue(card, key, value) {
  const el = card.querySelector(`[data-info="${key}"]`);
  if (el) el.textContent = value;
}

function removeCard(name) {
  const card = cardElements[name];
  if (card) {
    card.remove();
    delete cardElements[name];
  }
  if (xtermInstances[name]) {
    xtermInstances[name].dispose();
    delete xtermInstances[name];
  }
  delete outputModes[name];
}

function buildCardHTML(session) {
  const wt = session.worktree;
  const wtClass = wt ? '' : ' hidden';
  const wtText = wt ? `${wt.branch} → ${wt.path}` : '';

  return `
    <div class="card-header">
      <span class="card-status-dot ${session.status}"></span>
      <span class="card-name">${escHtml(session.name)}</span>
      <span class="card-badge badge-agent">${escHtml(session.agentType.toUpperCase())}</span>
      <span class="card-badge badge-role">${escHtml(session.role.toUpperCase())}</span>
      ${session.attached ? '<span class="card-badge badge-attached">ATTACHED</span>' : ''}
    </div>
    <div class="card-body">
      <div class="card-info-row">
        <span class="card-info-label">STATUS</span>
        <span class="card-info-value" data-info="status-text">${session.status.toUpperCase()}</span>
      </div>
      <div class="card-info-row">
        <span class="card-info-label">UPTIME</span>
        <span class="card-info-value" data-info="uptime">${escHtml(session.uptime)}</span>
      </div>
      <div class="card-info-row">
        <span class="card-info-label">WORKDIR</span>
        <span class="card-info-value" data-info="workdir">${escHtml(session.workdir)}</span>
      </div>
      <div class="card-info-row worktree-row${wtClass}">
        <span class="card-info-label">WORKTREE</span>
        <span class="card-info-value worktree" data-info="worktree">${escHtml(wtText)}</span>
      </div>
      <div class="card-ssh">
        <span class="card-info-label" style="min-width:auto">SSH</span>
        <code class="ssh-code">${escHtml(session.sshCommand)}</code>
        <button class="btn-icon copy-ssh" title="Copy to clipboard">⎘</button>
      </div>
    </div>
    <div class="card-output-header">
      <span class="section-label" style="font-size:9px">// OUTPUT</span>
      <div class="output-mode-group">
        <button class="output-mode-btn active" data-mode="off">OFF</button>
        <button class="output-mode-btn" data-mode="tail">TAIL</button>
        <button class="output-mode-btn" data-mode="full">FULL</button>
      </div>
    </div>
    <div class="card-output">
      <pre></pre>
    </div>
    <div class="card-actions">
      <input class="send-input" placeholder="// send command..." />
      <button class="btn-send">SEND</button>
      <button class="btn-kill">KILL</button>
    </div>
  `;
}

function bindCardEvents(card, sessionName) {
  // Copy SSH
  card.querySelector('.copy-ssh').addEventListener('click', () => {
    const cmd = card.querySelector('.ssh-code').textContent;
    navigator.clipboard.writeText(cmd).then(() => {
      showToast('SSH_COMMAND_COPIED', 'success');
    });
  });

  // Output mode toggle
  card.querySelectorAll('.output-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setOutputMode(card, sessionName, mode);
    });
  });

  // Send
  const sendInput = card.querySelector('.send-input');
  const sendBtn = card.querySelector('.btn-send');

  sendBtn.addEventListener('click', () => {
    const text = sendInput.value.trim();
    if (!text) return;
    wsSend({ type: 'send', session: sessionName, text });
    sendInput.value = '';
    showToast(`SENT → ${sessionName}`, 'success');
  });

  sendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendBtn.click();
    }
  });

  // Kill
  card.querySelector('.btn-kill').addEventListener('click', () => {
    showConfirm(sessionName);
  });
}

// ============================================
// OUTPUT MODE
// ============================================

function setOutputMode(card, sessionName, mode) {
  outputModes[sessionName] = mode;

  // Update button states
  card.querySelectorAll('.output-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const outputEl = card.querySelector('.card-output');

  // Clean up existing xterm
  if (xtermInstances[sessionName]) {
    xtermInstances[sessionName].dispose();
    delete xtermInstances[sessionName];
  }

  if (mode === 'off') {
    outputEl.classList.remove('visible');
    wsSend({ type: 'subscribe', session: sessionName, mode: 'off' });
    return;
  }

  outputEl.classList.add('visible');

  if (mode === 'full' && typeof Terminal !== 'undefined') {
    outputEl.innerHTML = '<div class="xterm-container"></div>';
    const container = outputEl.querySelector('.xterm-container');
    const term = new Terminal({
      theme: {
        background: '#1A1A1A',
        foreground: '#C8D6E5',
        cursor: '#4A8B94',
        selectionBackground: 'rgba(74,139,148,0.3)',
        black: '#1A1A1A',
        red: '#FF4500',
        green: '#4ADE80',
        yellow: '#FACC15',
        blue: '#4A8B94',
        magenta: '#A78BFA',
        cyan: '#5CB8C4',
        white: '#C8D6E5'
      },
      fontSize: 11,
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      rows: 20,
      cols: 80,
      scrollback: 500,
      cursorBlink: false
    });
    term.open(container);
    xtermInstances[sessionName] = term;
    wsSend({ type: 'subscribe', session: sessionName, mode: 'full' });
  } else {
    outputEl.innerHTML = '<pre></pre>';
    wsSend({ type: 'subscribe', session: sessionName, mode: 'tail' });
  }
}

// ============================================
// LAUNCH PANEL
// ============================================

function initLaunchPanel() {
  const presetsGrid = document.getElementById('presets-grid');

  fetch('/api/config')
    .then(r => r.json())
    .then(config => {
      renderPresets(presetsGrid, config.presets);
    })
    .catch(() => {
      // Fallback presets
      const fallbackPresets = [
        { label: 'CODEX_BUILDER', agent: 'codex', role: 'builder', icon: '>' },
        { label: 'OPUS_BUILDER', agent: 'opus', role: 'builder', icon: '◆' },
        { label: 'SONNET_BUILDER', agent: 'sonnet', role: 'builder', icon: '◇' },
        { label: 'GEMINI_BUILDER', agent: 'gemini', role: 'builder', icon: '▲' },
        { label: 'HAIKU_RESEARCHER', agent: 'haiku', role: 'researcher', icon: '◎' },
        { label: 'CODEX_REVIEWER', agent: 'codex', role: 'reviewer', icon: '⊡' }
      ];
      renderPresets(presetsGrid, fallbackPresets);
    });

  // Advanced toggle
  document.getElementById('toggle-advanced').addEventListener('click', () => {
    const form = document.getElementById('advanced-form');
    const btn = document.getElementById('toggle-advanced');
    form.classList.toggle('hidden');
    btn.textContent = form.classList.contains('hidden') ? 'ADVANCED ▾' : 'ADVANCED ▴';
  });

  // Launch button
  document.getElementById('launch-btn').addEventListener('click', () => {
    const agent = document.getElementById('launch-agent').value;
    const role = document.getElementById('launch-role').value;
    const workdir = document.getElementById('launch-workdir').value.trim();
    const sessionName = document.getElementById('launch-name').value.trim();
    const flags = document.getElementById('launch-flags').value.trim();

    wsSend({
      type: 'launch',
      agent,
      role,
      workdir: workdir || undefined,
      sessionName: sessionName || undefined,
      flags: flags || undefined
    });
  });
}

function renderPresets(container, presets) {
  container.innerHTML = '';
  for (const preset of presets) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.innerHTML = `<span class="preset-icon">${preset.icon || '◈'}</span>${preset.label}`;
    btn.addEventListener('click', () => {
      wsSend({
        type: 'launch',
        agent: preset.agent,
        role: preset.role
      });
    });
    container.appendChild(btn);
  }
}

// ============================================
// CONFIRM MODAL
// ============================================

function showConfirm(sessionName) {
  pendingKill = sessionName;
  const modal = document.getElementById('confirm-modal');
  const msg = document.getElementById('confirm-message');
  msg.innerHTML = `Terminate session <strong>${escHtml(sessionName)}</strong>?<br>This action cannot be undone.`;
  modal.classList.remove('hidden');
}

function hideConfirm() {
  pendingKill = null;
  document.getElementById('confirm-modal').classList.add('hidden');
}

document.getElementById('confirm-cancel').addEventListener('click', hideConfirm);
document.getElementById('confirm-ok').addEventListener('click', () => {
  if (pendingKill) {
    wsSend({ type: 'kill', session: pendingKill });
    hideConfirm();
  }
});

// Escape to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideConfirm();
});

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = `// ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================
// UI HELPERS
// ============================================

function setConnectionStatus(text, isError) {
  const el = document.getElementById('connection-status');
  el.textContent = text;
  el.className = isError ? 'status-error' : 'status-active';
}

function updateSessionCount(count) {
  document.getElementById('session-count').textContent = `${count} SESSION${count !== 1 ? 'S' : ''}`;
}

function updateEmptyState(empty) {
  document.getElementById('empty-state').classList.toggle('visible', empty);
  document.getElementById('agent-grid').style.display = empty ? 'none' : '';
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initLaunchPanel();
  connect();
});
