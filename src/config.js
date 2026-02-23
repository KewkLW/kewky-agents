const PORT = process.env.AGENT_DASH_PORT || 3847;
const POLL_INTERVAL = 3000;
const TAILSCALE_HOST = process.env.TAILSCALE_HOST || 'wsl-kewkd';

const CMD_BASE = 'C:/Users/kewkd/.local/bin';

const AGENTS = {
  opus: {
    model: 'claude-opus-4-6',
    launchCmd: `cmd.exe /c "${CMD_BASE}/claude-clean.cmd" --dangerously-skip-permissions --chrome --model claude-opus-4-6`,
    readyIndicator: /Try "edit"/,
    type: 'claude'
  },
  sonnet: {
    model: 'claude-sonnet-4-5-20250929',
    launchCmd: `cmd.exe /c "${CMD_BASE}/claude-clean.cmd" --dangerously-skip-permissions --chrome --model claude-sonnet-4-5-20250929`,
    readyIndicator: /Try "edit"/,
    type: 'claude'
  },
  haiku: {
    model: 'claude-haiku-4-5-20251001',
    launchCmd: `cmd.exe /c "${CMD_BASE}/claude-clean.cmd" --dangerously-skip-permissions --chrome --model claude-haiku-4-5-20251001`,
    readyIndicator: /Try "edit"/,
    type: 'claude'
  },
  codex: {
    model: 'gpt-5.3-codex',
    launchCmd: `cmd.exe /c "${CMD_BASE}/codex-clean.cmd" --yolo`,
    readyIndicator: /[›>]\s*$/,
    type: 'codex'
  },
  gemini: {
    model: 'gemini-3-pro-preview',
    launchCmd: `cmd.exe /c "${CMD_BASE}/gemini-clean.cmd" --yolo`,
    readyIndicator: /[›>]\s*$/,
    type: 'gemini',
    postLaunch: 'C-y' // Ctrl+Y confirm after 3s
  }
};

const PRESETS = [
  { label: 'CODEX_BUILDER', agent: 'codex', role: 'builder', icon: '>' },
  { label: 'OPUS_BUILDER', agent: 'opus', role: 'builder', icon: '◆' },
  { label: 'SONNET_BUILDER', agent: 'sonnet', role: 'builder', icon: '◇' },
  { label: 'GEMINI_BUILDER', agent: 'gemini', role: 'builder', icon: '▲' },
  { label: 'HAIKU_RESEARCHER', agent: 'haiku', role: 'researcher', icon: '◎' },
  { label: 'CODEX_REVIEWER', agent: 'codex', role: 'reviewer', icon: '⊡' }
];

module.exports = { PORT, POLL_INTERVAL, TAILSCALE_HOST, AGENTS, PRESETS, CMD_BASE };
