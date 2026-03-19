const os = require('os');
const path = require('path');
const { getRemoteHosts } = require('./platform');

const PORT = process.env.AGENT_DASH_PORT || 3847;
const POLL_INTERVAL = 3000;
const TAILSCALE_HOST = process.env.TAILSCALE_HOST || 'localhost';
const ACTIVE_TEAM = process.env.ACTIVE_TEAM || '';
const TEAMS_MCP_PATH = process.env.TEAMS_MCP_PATH || '';
const USER_HOME = process.env.USERPROFILE || os.homedir();
const CODEX_HOME_PRIMARY = process.env.CODEX_HOME || path.join(USER_HOME, '.codex');
const CODEX_HOME_ALT = process.env.CODEX_HOME_ALT || path.join(USER_HOME, '.codex-account-b');

const WSL_DISTRO = process.env.WSL_DISTRO || 'Ubuntu-24.04';
const REMOTE_HOSTS = getRemoteHosts();

const AGENTS = {
  opus: {
    model: 'claude-opus-4-6[1m]',
    launchCmd: 'claude --dangerously-skip-permissions --model "claude-opus-4-6[1m]"',
    readyIndicator: /Try|context left/,
    type: 'claude'
  },
  'team-lead': {
    model: 'claude-opus-4-6[1m]',
    launchCmd: 'claude --dangerously-skip-permissions --model "claude-opus-4-6[1m]"',
    readyIndicator: /Try|context left/,
    type: 'claude',
    role: 'team-lead',
    initPrompt: `You are the TEAM LEADER coordinating a multi-agent operation. Your responsibilities:

1. MONITOR agent status — I will periodically feed you session snapshots showing what each agent is doing
2. ASSIGN TASKS — Break high-level objectives into concrete tasks and assign them to the right agents
3. REVIEW OUTPUT — Check agent work products for quality and completeness
4. REDIRECT — If an agent is stuck or off-track, send corrective guidance
5. SYNTHESIZE — Combine outputs from multiple agents into coherent deliverables

You have access to claude-teams MCP tools for task management and messaging.
When you receive a mission briefing, decompose it into subtasks and distribute to available agents.
Use the dashboard to monitor progress. Be decisive and direct in your coordination.

Available agents: opus (builder), sonnet (builder), haiku (researcher), codex-primary (builder/reviewer), codex-alt (builder), gemini (builder), codex-nano (subagent/search), codex-mini (subagent/worker)

Respond with your coordination plan when given an objective.`
  },
  sonnet: {
    model: 'claude-sonnet-4-5-20250929',
    launchCmd: 'claude --dangerously-skip-permissions --model claude-sonnet-4-5-20250929',
    readyIndicator: /Try|context left/,
    type: 'claude'
  },
  haiku: {
    model: 'claude-haiku-4-5-20251001',
    launchCmd: 'claude --dangerously-skip-permissions --model claude-haiku-4-5-20251001',
    readyIndicator: /Try|context left/,
    type: 'claude'
  },
  'codex-primary': {
    model: 'gpt-5.4-codex',
    launchCmd: 'codex --yolo',
    env: { CODEX_HOME: CODEX_HOME_PRIMARY },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  'codex-alt': {
    model: 'gpt-5.4-codex',
    launchCmd: 'codex --yolo',
    env: { CODEX_HOME: CODEX_HOME_ALT },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  'codex-nano': {
    model: 'gpt-5.4-nano',
    launchCmd: 'codex --yolo --model gpt-5.4-nano',
    env: { CODEX_HOME: CODEX_HOME_PRIMARY },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  'codex-mini': {
    model: 'gpt-5.4-mini',
    launchCmd: 'codex --yolo --model gpt-5.4-mini',
    env: { CODEX_HOME: CODEX_HOME_PRIMARY },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  gemini: {
    model: 'gemini-3-pro-preview',
    launchCmd: 'gemini --yolo',
    readyIndicator: /Type your message|shortcuts/,
    type: 'gemini',
    postLaunch: '\x19' // Ctrl+Y byte
  }
};

// Lookup for tmux-style key names to raw bytes (for postLaunch compatibility)
const SPECIAL_KEYS = {
  'C-a': '\x01', 'C-b': '\x02', 'C-c': '\x03', 'C-d': '\x04',
  'C-e': '\x05', 'C-f': '\x06', 'C-g': '\x07', 'C-h': '\x08',
  'C-i': '\x09', 'C-j': '\x0a', 'C-k': '\x0b', 'C-l': '\x0c',
  'C-m': '\x0d', 'C-n': '\x0e', 'C-o': '\x0f', 'C-p': '\x10',
  'C-q': '\x11', 'C-r': '\x12', 'C-s': '\x13', 'C-t': '\x14',
  'C-u': '\x15', 'C-v': '\x16', 'C-w': '\x17', 'C-x': '\x18',
  'C-y': '\x19', 'C-z': '\x1a'
};

const PRESETS = [
  { label: 'TEAM_LEAD', agent: 'team-lead', role: 'team-lead', icon: '\u2605' },
  { label: 'CODEX_PRIMARY', agent: 'codex-primary', role: 'builder', icon: '>' },
  { label: 'CODEX_ALT', agent: 'codex-alt', role: 'builder', icon: '\u00BB' },
  { label: 'OPUS_BUILDER', agent: 'opus', role: 'builder', icon: '\u25C6' },
  { label: 'SONNET_BUILDER', agent: 'sonnet', role: 'builder', icon: '\u25C7' },
  { label: 'GEMINI_BUILDER', agent: 'gemini', role: 'builder', icon: '\u25B2' },
  { label: 'HAIKU_RESEARCHER', agent: 'haiku', role: 'researcher', icon: '\u25CE' },
  { label: 'CODEX_NANO', agent: 'codex-nano', role: 'subagent', icon: '\u00B7' },
  { label: 'CODEX_MINI', agent: 'codex-mini', role: 'subagent', icon: '\u25CB' },
  { label: 'CODEX_REVIEWER', agent: 'codex-primary', role: 'reviewer', icon: '\u22A1' }
];

// WSL presets — same agents but spawned inside WSL
const WSL_PRESETS = [
  { label: 'WSL_OPUS', agent: 'opus', role: 'builder', icon: '\u25C6', platform: 'wsl' },
  { label: 'WSL_SONNET', agent: 'sonnet', role: 'builder', icon: '\u25C7', platform: 'wsl' },
  { label: 'WSL_HAIKU', agent: 'haiku', role: 'researcher', icon: '\u25CE', platform: 'wsl' },
  { label: 'WSL_GEMINI', agent: 'gemini', role: 'builder', icon: '\u25B2', platform: 'wsl' },
  { label: 'WSL_CODEX', agent: 'codex-primary', role: 'builder', icon: '>', platform: 'wsl' }
];

// Remote presets — dynamically built from REMOTE_HOSTS env vars
const REMOTE_PRESETS = [];
for (const [hostName, hostConfig] of Object.entries(REMOTE_HOSTS)) {
  for (const agentKey of ['opus', 'sonnet', 'haiku']) {
    REMOTE_PRESETS.push({
      label: `${hostName.toUpperCase()}_${agentKey.toUpperCase()}`,
      agent: agentKey,
      role: 'builder',
      icon: agentKey === 'opus' ? '\u25C6' : agentKey === 'sonnet' ? '\u25C7' : '\u25CE',
      platform: 'ssh',
      host: hostName
    });
  }
}

module.exports = {
  PORT, POLL_INTERVAL, TAILSCALE_HOST,
  ACTIVE_TEAM, TEAMS_MCP_PATH, USER_HOME,
  AGENTS, PRESETS, SPECIAL_KEYS,
  WSL_DISTRO, REMOTE_HOSTS, WSL_PRESETS, REMOTE_PRESETS
};
