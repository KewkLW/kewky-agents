// AGENT_DASHBOARD // FRONTEND_CONTROLLER
// VECTORHEART_PROTOCOL // V1.1

// Debug logger — sends errors to server for remote viewing at /debug
const debugLog = {
  _send(level, message, data) {
    try {
      fetch('/api/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, message, data, timestamp: Date.now() })
      }).catch(() => {});
    } catch {}
  },
  log(msg, data) { console.log(msg, data || ''); this._send('log', msg, data); },
  warn(msg, data) { console.warn(msg, data || ''); this._send('warn', msg, data); },
  error(msg, data) { console.error(msg, data || ''); this._send('error', msg, data); },
  info(msg, data) { console.info(msg, data || ''); this._send('info', msg, data); }
};

// Catch all uncaught errors
window.onerror = (msg, src, line, col, err) => {
  debugLog.error(`UNCAUGHT: ${msg}`, { src, line, col, stack: err?.stack });
};
window.onunhandledrejection = (e) => {
  debugLog.error(`UNHANDLED_PROMISE: ${e.reason}`, { stack: e.reason?.stack });
};

// Fingerprint any injected Web3/ethereum objects
setTimeout(() => {
  if (window.ethereum) {
    debugLog.warn('ETHEREUM_INJECTED', {
      isMetaMask: window.ethereum.isMetaMask,
      isTrust: window.ethereum.isTrust,
      isCoinbaseWallet: window.ethereum.isCoinbaseWallet,
      isBraveWallet: window.ethereum.isBraveWallet,
      isRabby: window.ethereum.isRabby,
      isPhantom: window.ethereum.isPhantom,
      isTokenPocket: window.ethereum.isTokenPocket,
      isOkxWallet: window.ethereum.isOkxWallet,
      constructorName: window.ethereum.constructor?.name,
      providerKeys: Object.keys(window.ethereum).slice(0, 20),
      userAgent: navigator.userAgent
    });
  }
  // Check for other injected globals that shouldn't be there
  const suspicious = ['solana', 'phantom', 'trustwallet', '__metamask', 'web3', 'BinanceChain'].filter(k => window[k]);
  if (suspicious.length) {
    debugLog.warn('SUSPICIOUS_GLOBALS', { found: suspicious, userAgent: navigator.userAgent });
  }
}, 2000);

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;

let ws = null;
let reconnectDelay = RECONNECT_BASE;
let sessions = [];
let cardElements = {};
let outputModes = {};
let xtermInstances = {};
let pendingKill = null;
let missions = [];
let missionElements = {};
let TAILSCALE_HOST = 'localhost';

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
    try { msg = JSON.parse(e.data); } catch (err) { debugLog.error('WS_PARSE_FAIL', { raw: e.data?.slice(0, 200), err: err.message }); return; }
    debugLog.log(`WS_MSG: ${msg.type}`, msg.type === 'output' ? { session: msg.session } : undefined);

    switch (msg.type) {
      case 'config':
        TAILSCALE_HOST = msg.tailscaleHost || TAILSCALE_HOST;
        break;
      case 'state':
        handleStateUpdate(msg.sessions);
        break;
      case 'output':
        handleOutputUpdate(msg.session, msg.lines);
        break;
      case 'research_state':
        handleResearchState(msg.missions);
        break;
      case 'report':
        showReportModal(msg.report);
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
    case 'session_attached':
      showToast(`POWERSHELL_ATTACHED: ${data.session}`, 'success');
      break;
    case 'research_deployed':
      showToast(`RESEARCH_DEPLOYED: "${data.topic}" → [${data.agents.join(', ')}]`, 'success');
      break;
    case 'mission_killed':
      showToast(`MISSION_TERMINATED: ${data.missionId}`, 'success');
      break;
    case 'error':
      showToast(`ERROR: ${data.message}`, 'error');
      break;
    case 'tasks_distributed':
      for (const a of (data.assignments || [])) {
        showToast(`◈ ASSIGNED: Task ${a.task_id} → ${a.agent}`, 'success');
      }
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

  // Update platform badge
  let platformBadge = card.querySelector('.badge-platform');
  if (session.platform && session.platform !== 'native' && !platformBadge) {
    const header = card.querySelector('.card-header');
    const killBtn = header.querySelector('.btn-kill-header');
    platformBadge = document.createElement('span');
    platformBadge.className = `card-badge badge-platform badge-platform-${session.platform}`;
    platformBadge.textContent = session.platform.toUpperCase();
    header.insertBefore(platformBadge, killBtn);
  }

  // Update attached badge
  let attachedBadge = card.querySelector('.badge-attached');
  if (session.attached && !attachedBadge) {
    const header = card.querySelector('.card-header');
    const killBtn = header.querySelector('.btn-kill-header');
    attachedBadge = document.createElement('span');
    attachedBadge.className = 'card-badge badge-attached';
    attachedBadge.textContent = 'ATTACHED';
    header.insertBefore(attachedBadge, killBtn);
  } else if (!session.attached && attachedBadge) {
    attachedBadge.remove();
  }

  // Update info values
  updateInfoValue(card, 'uptime', session.uptime);
  updateInfoValue(card, 'workdir', session.workdir);
  const statusEl = card.querySelector('[data-info="status-text"]');
  if (statusEl) {
    statusEl.textContent = session.status.toUpperCase().replace('_', ' ');
    statusEl.className = `card-info-value status-${session.status}`;
  }

  // Update worktree
  const wtRow = card.querySelector('.worktree-row');
  if (session.worktree && wtRow) {
    wtRow.classList.remove('hidden');
    updateInfoValue(card, 'worktree', `${session.worktree.branch} → ${session.worktree.path}`);
  } else if (wtRow) {
    wtRow.classList.add('hidden');
  }

  // Update terminal URL
  const sshCode = card.querySelector('.ssh-code');
  if (sshCode) sshCode.textContent = session.terminalUrl || '';

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
      ${session.platform && session.platform !== 'native' ? `<span class="card-badge badge-platform badge-platform-${escHtml(session.platform)}">${escHtml(session.platform.toUpperCase())}</span>` : ''}
      ${session.attached ? '<span class="card-badge badge-attached">ATTACHED</span>' : ''}
      <button class="btn-kill btn-kill-header">✕</button>
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
        <span class="card-info-label" style="min-width:auto">URL</span>
        <code class="ssh-code">${escHtml(session.terminalUrl || '')}</code>
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
      <button class="btn-attach" data-session="${escHtml(session.name)}">ATTACH</button>
    </div>
  `;
}

function bindCardEvents(card, sessionName) {
  // Copy SSH
  card.querySelector('.copy-ssh').addEventListener('click', () => {
    const cmd = card.querySelector('.ssh-code').textContent;
    navigator.clipboard.writeText(cmd).then(() => {
      showToast('URL_COPIED', 'success');
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

  // Attach handled by delegated handler below (avoids double-fire)

  // Kill (header button)
  card.querySelector('.btn-kill-header').addEventListener('click', () => {
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

    // Make terminal interactive — send keystrokes to session
    term.onData(data => {
      wsSend({ type: 'raw_input', session: sessionName, data });
    });
    term.focus();

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
      // CORE section — always visible
      renderPresets(presetsGrid, config.presets);
      populateAgentDropdown(config.agents);
      populateAgentSelector(config.agentDetails || {});

      // PLATFORMS section — only if WSL or remote hosts available
      const hasWSL = config.wslAvailable && config.wslPresets && config.wslPresets.length > 0;
      const hasRemote = config.remoteHostsConfigured && config.remotePresets && config.remotePresets.length > 0;

      if (hasWSL || hasRemote) {
        const launchPanel = document.getElementById('launch-panel');
        const platformSection = createCollapsibleSection('PLATFORMS', launchPanel);

        if (hasWSL) {
          renderPresetSubsection(platformSection.body, 'WSL', config.wslPresets);
        }
        if (hasRemote) {
          renderPresetSubsection(platformSection.body, 'REMOTE', config.remotePresets);
        }
      }
    })
    .catch(() => {
      // Fallback presets
      const fallbackPresets = [
        { label: 'OPUS_BUILDER', agent: 'opus', role: 'builder', icon: '\u25C6' },
        { label: 'SONNET_BUILDER', agent: 'sonnet', role: 'builder', icon: '\u25C7' },
        { label: 'GEMINI_BUILDER', agent: 'gemini', role: 'builder', icon: '\u25B2' },
        { label: 'HAIKU_RESEARCHER', agent: 'haiku', role: 'researcher', icon: '\u25CE' }
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

function populateAgentDropdown(agents) {
  const select = document.getElementById('launch-agent');
  select.innerHTML = '';
  for (const name of agents) {
    if (name === 'team-lead') continue; // team-lead uses preset
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.toUpperCase();
    select.appendChild(opt);
  }
}

function populateAgentSelector(agentDetails) {
  const container = document.getElementById('agent-selector');
  if (!container || Object.keys(agentDetails).length === 0) return;

  const ICONS = { opus: '\u25C6', sonnet: '\u25C7', haiku: '\u25CE', gemini: '\u25B2' };
  container.innerHTML = '';

  for (const [name, details] of Object.entries(agentDetails)) {
    if (name === 'team-lead') continue;
    const icon = ICONS[name] || '>';
    const label = document.createElement('label');
    label.className = 'agent-checkbox';
    label.innerHTML = `
      <input type="checkbox" value="${escHtml(name)}">
      <span class="agent-check-box"></span>
      <span class="agent-check-icon">${icon}</span>
      <span class="agent-check-label">${escHtml(name.toUpperCase())}</span>
      <span class="agent-check-model">${escHtml(details.model || '')}</span>
    `;
    container.appendChild(label);
  }
}

function renderPresets(container, presets) {
  container.innerHTML = '';
  for (const preset of presets) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.innerHTML = `<span class="preset-icon">${preset.icon || '\u25C8'}</span>${preset.label}`;
    btn.addEventListener('click', () => {
      const msg = {
        type: 'launch',
        agent: preset.agent,
        role: preset.role
      };
      if (preset.platform) msg.platform = preset.platform;
      if (preset.host) msg.host = preset.host;
      wsSend(msg);
    });
    container.appendChild(btn);
  }
}

function createCollapsibleSection(title, parent) {
  const section = document.createElement('div');
  section.className = 'preset-section';

  const header = document.createElement('div');
  header.className = 'preset-section-header';
  header.innerHTML = `<span class="section-label" style="font-size:10px">${escHtml(title)}</span><span class="preset-section-toggle">+</span>`;

  const body = document.createElement('div');
  body.className = 'preset-section-body';
  body.style.display = 'none';

  header.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'flex';
    header.querySelector('.preset-section-toggle').textContent = isOpen ? '+' : '\u2212';
  });

  section.appendChild(header);
  section.appendChild(body);
  parent.appendChild(section);

  return { section, header, body };
}

function renderPresetSubsection(container, label, presets) {
  const sub = document.createElement('div');
  sub.className = 'preset-subsection';

  const subLabel = document.createElement('div');
  subLabel.className = 'preset-subsection-label';
  subLabel.textContent = label;
  sub.appendChild(subLabel);

  const grid = document.createElement('div');
  grid.className = 'presets-grid';
  grid.style.padding = '4px 0';

  for (const preset of presets) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn preset-btn-platform';
    btn.innerHTML = `<span class="preset-icon">${preset.icon || '\u25C8'}</span>${preset.label}`;
    btn.addEventListener('click', () => {
      const msg = {
        type: 'launch',
        agent: preset.agent,
        role: preset.role
      };
      if (preset.platform) msg.platform = preset.platform;
      if (preset.host) msg.host = preset.host;
      wsSend(msg);
    });
    grid.appendChild(btn);
  }

  sub.appendChild(grid);
  container.appendChild(sub);
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

// Escape key handling moved to report viewer section below

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
// TAB NAVIGATION
// ============================================

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

// ============================================
// RESEARCH
// ============================================

function initResearch() {
  document.getElementById('research-deploy-btn').addEventListener('click', () => {
    const topic = document.getElementById('research-topic').value.trim();
    if (!topic) {
      showToast('TOPIC_REQUIRED', 'error');
      return;
    }

    const scope = document.getElementById('research-scope').value.trim();
    const focus = document.getElementById('research-focus').value.trim();
    const ignore = document.getElementById('research-ignore').value.trim();
    const returnFormat = document.getElementById('research-format').value.trim();

    const agents = [];
    document.querySelectorAll('#agent-selector input[type="checkbox"]:checked').forEach(cb => {
      agents.push(cb.value);
    });

    if (agents.length === 0) {
      showToast('SELECT_AT_LEAST_ONE_AGENT', 'error');
      return;
    }

    wsSend({
      type: 'research',
      topic,
      scope: scope || undefined,
      focus: focus || undefined,
      ignore: ignore || undefined,
      returnFormat: returnFormat || undefined,
      agents
    });

    // Clear form
    document.getElementById('research-topic').value = '';
    document.getElementById('research-scope').value = '';
    document.getElementById('research-focus').value = '';
    document.getElementById('research-ignore').value = '';
    document.getElementById('research-format').value = '';
  });
}

function handleResearchState(newMissions) {
  missions = newMissions;

  const grid = document.getElementById('missions-grid');
  const empty = document.getElementById('missions-empty');
  const hasActive = newMissions.length > 0;

  empty.classList.toggle('visible', !hasActive);
  grid.style.display = hasActive ? '' : 'none';

  // Build set of current mission IDs
  const currentIds = new Set(newMissions.map(m => m.id));

  // Remove old cards
  for (const id of Object.keys(missionElements)) {
    if (!currentIds.has(id)) {
      missionElements[id].remove();
      delete missionElements[id];
    }
  }

  // Create or update cards
  for (const mission of newMissions) {
    if (missionElements[mission.id]) {
      updateMissionCard(mission);
    } else {
      createMissionCard(mission);
    }
  }
}

function createMissionCard(mission) {
  const card = document.createElement('div');
  card.className = 'mission-card';
  card.dataset.missionId = mission.id;

  const canView = mission.status === 'complete' || mission.status === 'partial' || mission.status === 'history';
  if (canView) card.classList.add('clickable');

  card.innerHTML = buildMissionHTML(mission);

  // Bind kill button (stopPropagation so card click doesn't fire)
  const killBtn = card.querySelector('.btn-kill-mission');
  if (killBtn) {
    killBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      wsSend({ type: 'kill_mission', missionId: mission.id });
    });
  }

  // Card click → open report
  card.addEventListener('click', () => {
    if (canView || mission.status === 'running' || mission.status === 'deploying') {
      requestReport(mission.id, mission.slug);
    }
  });

  document.getElementById('missions-grid').appendChild(card);
  missionElements[mission.id] = card;
}

function updateMissionCard(mission) {
  const card = missionElements[mission.id];
  if (!card) return;

  const canView = mission.status === 'complete' || mission.status === 'partial' || mission.status === 'history';
  card.classList.toggle('clickable', canView || mission.status === 'running' || mission.status === 'deploying');

  // Update status badge
  const badge = card.querySelector('.mission-status-badge');
  badge.className = `mission-status-badge ${mission.status}`;
  badge.textContent = mission.status.toUpperCase();

  // Update agent chips
  const chipsContainer = card.querySelector('.mission-agents');
  chipsContainer.innerHTML = buildAgentChipsHTML(mission.agents);

  // Update output dir
  const outputVal = card.querySelector('[data-info="output-dir"]');
  if (outputVal) outputVal.textContent = mission.outputDir;
}

function buildMissionHTML(mission) {
  const agentChips = buildAgentChipsHTML(mission.agents);
  const canKill = mission.status === 'deploying' || mission.status === 'running';
  const createdTime = new Date(mission.createdAt).toLocaleTimeString();
  const canView = mission.status === 'complete' || mission.status === 'partial' || mission.status === 'history' || mission.status === 'running' || mission.status === 'deploying';
  const dotClass = mission.status === 'running' || mission.status === 'deploying' ? 'running' : mission.status === 'complete' || mission.status === 'history' ? 'ready' : 'idle';
  const scopeHtml = mission.scope ? `<div class="mission-scope">${escHtml(mission.scope)}</div>` : '';

  return `
    <div class="mission-header">
      <span class="card-status-dot ${dotClass}"></span>
      <span class="mission-topic">${escHtml(mission.topic)}</span>
      <span class="mission-status-badge ${mission.status}">${mission.status.toUpperCase()}</span>
    </div>
    ${scopeHtml}
    <div class="mission-body">
      <div class="mission-info-row">
        <span class="mission-info-label">OUTPUT</span>
        <span class="mission-info-value" data-info="output-dir">${escHtml(mission.outputDir)}</span>
      </div>
      <div class="mission-info-row">
        <span class="mission-info-label">STARTED</span>
        <span class="mission-info-value">${createdTime}</span>
      </div>
      <div class="mission-agents">
        ${agentChips}
      </div>
    </div>
    ${canKill ? `
    <div class="mission-actions">
      <button class="btn-kill btn-kill-mission">ABORT MISSION</button>
    </div>` : ''}
    ${canView ? '<div class="mission-view-hint">CLICK TO VIEW REPORT</div>' : ''}
  `;
}

function buildAgentChipsHTML(agents) {
  return Object.entries(agents).map(([name, state]) => {
    const statusLabel = state.status.replace(/_/g, ' ');
    return `
      <div class="mission-agent-chip">
        <span class="chip-dot ${state.status}"></span>
        <span class="chip-name">${name.toUpperCase()}</span>
        <span class="chip-status">${statusLabel}</span>
      </div>
    `;
  }).join('');
}

// ============================================
// REPORT VIEWER
// ============================================

const AGENT_ICONS = { codex: '>', opus: '\u25C6', sonnet: '\u25C7', haiku: '\u25CE', gemini: '\u25B2' };
let currentReport = null;
let currentReportFilter = 'all';

function requestReport(missionId, slug) {
  wsSend({ type: 'get_report', missionId, slug });
}

function showReportModal(report) {
  currentReport = report;
  currentReportFilter = 'all';

  const viewer = document.getElementById('report-viewer');
  const title = document.getElementById('report-title');
  const badge = document.getElementById('report-status-badge');
  const tabs = document.getElementById('report-tabs');

  title.textContent = report.topic;
  badge.className = `mission-status-badge ${report.status}`;
  badge.textContent = report.status.toUpperCase();

  // Build agent tabs
  const agentNames = Object.keys(report.agents);
  let tabsHtml = '<button class="report-tab active" data-agent="all">ALL</button>';
  for (const name of agentNames) {
    const icon = AGENT_ICONS[name] || '\u25C8';
    tabsHtml += `<button class="report-tab" data-agent="${name}">${icon} ${name.toUpperCase()}</button>`;
  }
  tabs.innerHTML = tabsHtml;

  // Bind tab clicks
  tabs.querySelectorAll('.report-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentReportFilter = tab.dataset.agent;
      renderReportContent(report, currentReportFilter);
    });
  });

  renderReportContent(report, 'all');
  viewer.classList.remove('hidden');
}

function renderReportContent(report, filter) {
  const container = document.getElementById('report-content');
  let html = '';

  const renderMd = (md) => {
    if (typeof marked !== 'undefined' && marked.parse) {
      try { return marked.parse(md); } catch { /* fall through */ }
    }
    return `<pre>${escHtml(md)}</pre>`;
  };

  if (filter === 'all') {
    // Show brief first
    if (report.brief) {
      html += '<div class="report-agent-separator"><span class="agent-icon">\u25C8</span><span class="agent-label">RESEARCH BRIEF</span></div>';
      html += renderMd(report.brief);
    }

    // Show each agent
    for (const [name, data] of Object.entries(report.agents)) {
      const icon = AGENT_ICONS[name] || '\u25C8';
      html += `<div class="report-agent-separator"><span class="agent-icon">${icon}</span><span class="agent-label">${name.toUpperCase()}</span></div>`;
      if (data.content && data.content.trim()) {
        html += renderMd(data.content);
      } else {
        html += '<div class="report-no-output">// NO OUTPUT YET</div>';
      }
    }
  } else {
    const data = report.agents[filter];
    if (data && data.content && data.content.trim()) {
      html = renderMd(data.content);
    } else {
      html = '<div class="report-no-output">// NO OUTPUT YET</div>';
    }
  }

  if (!html) {
    html = '<div class="report-no-output">// NO REPORT DATA AVAILABLE</div>';
  }

  container.innerHTML = html;
  document.getElementById('report-body').scrollTop = 0;
}

function hideReport() {
  document.getElementById('report-viewer').classList.add('hidden');
  currentReport = null;
}

// Close report
document.getElementById('report-close').addEventListener('click', hideReport);

// Escape key: close report first, then confirm modal
document.removeEventListener('keydown', handleEscapeKey);
function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    if (currentReport) {
      hideReport();
    } else {
      hideConfirm();
    }
  }
}
document.addEventListener('keydown', handleEscapeKey);

// ============================================
// INIT
// ============================================

// ============================================
// SETTINGS
// ============================================

function loadSettings() {
  try {
    const saved = localStorage.getItem('agent-dashboard-settings');
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

function saveSettings(settings) {
  try {
    localStorage.setItem('agent-dashboard-settings', JSON.stringify(settings));
  } catch {}
}

function initSettings() {
  const settings = loadSettings();
  const defaults = { wsl: true, remote: true, research: true, advanced: true };
  const merged = { ...defaults, ...settings };

  // Set initial checkbox states
  for (const [key, val] of Object.entries(merged)) {
    const el = document.getElementById(`setting-${key}`);
    if (el) el.checked = val;
  }

  // Apply visibility
  applySettings(merged);

  // Bind change events
  for (const key of Object.keys(defaults)) {
    const el = document.getElementById(`setting-${key}`);
    if (el) {
      el.addEventListener('change', () => {
        const current = loadSettings();
        current[key] = el.checked;
        saveSettings(current);
        applySettings({ ...defaults, ...current });
      });
    }
  }

  // Populate platform status
  fetch('/api/config')
    .then(r => r.json())
    .then(config => {
      const container = document.getElementById('platform-status');
      if (!container) return;

      let html = '';

      // Local platform
      if (config.localPlatform) {
        const lp = config.localPlatform;
        html += `<div class="platform-status-card">
          <span class="platform-status-dot available"></span>
          <span class="platform-status-name">LOCAL</span>
          <span class="platform-status-detail">${escHtml(lp.os)} (${escHtml(lp.arch)}) // ${escHtml(lp.hostname)}</span>
        </div>`;
      }

      // WSL status
      html += `<div class="platform-status-card">
        <span class="platform-status-dot ${config.wslAvailable ? 'available' : 'unavailable'}"></span>
        <span class="platform-status-name">WSL</span>
        <span class="platform-status-detail">${config.wslAvailable ? config.wslDistros.join(', ') : 'Not available'}</span>
      </div>`;

      // Remote hosts
      if (config.remoteHostsConfigured) {
        for (const [name, info] of Object.entries(config.remoteHosts)) {
          const osLabel = (info.os || 'linux').toUpperCase();
          html += `<div class="platform-status-card">
            <span class="platform-status-dot available"></span>
            <span class="platform-status-name">SSH: ${escHtml(name.toUpperCase())}</span>
            <span class="platform-status-detail">${escHtml(info.user)}@${escHtml(info.host)}:${info.port} [${osLabel}]</span>
          </div>`;
        }
      } else {
        html += `<div class="platform-status-card">
          <span class="platform-status-dot unavailable"></span>
          <span class="platform-status-name">SSH REMOTE</span>
          <span class="platform-status-detail">No REMOTE_HOST_* env vars configured</span>
        </div>`;
      }

      container.innerHTML = html;
    })
    .catch(() => {});
}

function applySettings(settings) {
  // Research tab visibility
  const researchTab = document.querySelector('[data-tab="research"]');
  const researchContent = document.getElementById('tab-research');
  if (researchTab) researchTab.style.display = settings.research ? '' : 'none';
  if (researchContent && !settings.research) researchContent.classList.remove('active');

  // Advanced launch form toggle button
  const advancedToggle = document.getElementById('toggle-advanced');
  if (advancedToggle) advancedToggle.style.display = settings.advanced ? '' : 'none';
  if (!settings.advanced) {
    const advForm = document.getElementById('advanced-form');
    if (advForm) advForm.classList.add('hidden');
  }

  // WSL/Remote are applied when presets render (they check config + settings)
  document.documentElement.dataset.showWsl = settings.wsl ? '1' : '0';
  document.documentElement.dataset.showRemote = settings.remote ? '1' : '0';

  // Hide/show platform preset sections that may already be rendered
  document.querySelectorAll('.preset-subsection').forEach(sub => {
    const label = sub.querySelector('.preset-subsection-label');
    if (label) {
      if (label.textContent === 'WSL') sub.style.display = settings.wsl ? '' : 'none';
      if (label.textContent === 'REMOTE') sub.style.display = settings.remote ? '' : 'none';
    }
  });

  // Hide the entire PLATFORMS section if both WSL and REMOTE are off
  document.querySelectorAll('.preset-section').forEach(sec => {
    const header = sec.querySelector('.preset-section-header .section-label');
    if (header && header.textContent === 'PLATFORMS') {
      sec.style.display = (settings.wsl || settings.remote) ? '' : 'none';
    }
  });

}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initLaunchPanel();
  initResearch();
  initSettings();
  connect();

  // Delegated event handler for ATTACH buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-attach');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const sessionName = btn.dataset.session;
    if (!sessionName) return;
    debugLog.info(`ATTACH_DELEGATED: ${sessionName}`, { width: window.innerWidth });

    // Open in-browser terminal (works on all platforms)
    window.open(`/terminal.html?session=${encodeURIComponent(sessionName)}`, '_blank');
    showToast(`TERMINAL: ${sessionName}`, 'success');
  });
});
