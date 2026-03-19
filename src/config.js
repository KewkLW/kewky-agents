const PORT = process.env.AGENT_DASH_PORT || 3847;
const POLL_INTERVAL = 3000;
const TAILSCALE_HOST = process.env.TAILSCALE_HOST || 'kewk';

const AGENTS = {
  opus: {
    model: 'claude-opus-4-6',
    launchCmd: 'claude --dangerously-skip-permissions --model claude-opus-4-6',
    readyIndicator: /Try|context left/,
    type: 'claude'
  },
  'team-lead': {
    model: 'claude-opus-4-6',
    launchCmd: 'claude --dangerously-skip-permissions --model claude-opus-4-6',
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

Available agents: opus (builder), sonnet (builder), haiku (researcher), kewk-codex (builder/reviewer), lilkewk-codex (builder), gemini (builder), codex-nano (subagent/search), codex-mini (subagent/worker)

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
  'kewk-codex': {
    model: 'gpt-5.4-codex',
    launchCmd: 'codex --yolo',
    env: { CODEX_HOME: 'C:\\Users\\kewkd\\.codex' },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  'lilkewk-codex': {
    model: 'gpt-5.4-codex',
    launchCmd: 'codex --yolo',
    env: { CODEX_HOME: 'C:\\Users\\kewkd\\.codex-account-b' },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  'codex-nano': {
    model: 'gpt-5.4-nano',
    launchCmd: 'codex --yolo --model gpt-5.4-nano',
    env: { CODEX_HOME: 'C:\\Users\\kewkd\\.codex' },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  'codex-mini': {
    model: 'gpt-5.4-mini',
    launchCmd: 'codex --yolo --model gpt-5.4-mini',
    env: { CODEX_HOME: 'C:\\Users\\kewkd\\.codex' },
    readyIndicator: /›|codex/i,
    type: 'codex'
  },
  gemini: {
    model: 'gemini-3-pro-preview',
    launchCmd: 'gemini --yolo',
    readyIndicator: /Type your message|shortcuts/,
    type: 'gemini',
    postLaunch: 'C-y'
  }
};

const PRESETS = [
  { label: 'TEAM_LEAD', agent: 'team-lead', role: 'team-lead', icon: '★' },
  { label: 'KEWK_CODEX', agent: 'kewk-codex', role: 'builder', icon: '>' },
  { label: 'LILKEWK_CODEX', agent: 'lilkewk-codex', role: 'builder', icon: '»' },
  { label: 'OPUS_BUILDER', agent: 'opus', role: 'builder', icon: '◆' },
  { label: 'SONNET_BUILDER', agent: 'sonnet', role: 'builder', icon: '◇' },
  { label: 'GEMINI_BUILDER', agent: 'gemini', role: 'builder', icon: '▲' },
  { label: 'HAIKU_RESEARCHER', agent: 'haiku', role: 'researcher', icon: '◎' },
  { label: 'CODEX_NANO', agent: 'codex-nano', role: 'subagent', icon: '·' },
  { label: 'CODEX_MINI', agent: 'codex-mini', role: 'subagent', icon: '○' },
  { label: 'KEWK_REVIEWER', agent: 'kewk-codex', role: 'reviewer', icon: '⊡' }
];

module.exports = { PORT, POLL_INTERVAL, TAILSCALE_HOST, AGENTS, PRESETS };
