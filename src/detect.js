const AGENT_PATTERNS = {
  opus:   { names: ['opus'], content: /claude-opus/i },
  sonnet: { names: ['sonnet'], content: /claude-sonnet/i },
  haiku:  { names: ['haiku'], content: /claude-haiku/i },
  codex:  { names: ['codex'], content: /codex|gpt-5/i },
  gemini: { names: ['gemini'], content: /gemini/i }
};

const ROLE_PREFIXES = ['builder', 'researcher', 'reviewer', 'tester', 'deslop'];

function detectAgentType(sessionName, paneLines) {
  const nameLower = sessionName.toLowerCase();

  for (const [agent, pat] of Object.entries(AGENT_PATTERNS)) {
    if (pat.names.some(n => nameLower.includes(n))) return agent;
  }

  if (paneLines && paneLines.length > 0) {
    const content = paneLines.join('\n');
    for (const [agent, pat] of Object.entries(AGENT_PATTERNS)) {
      if (pat.content.test(content)) return agent;
    }
  }

  return 'unknown';
}

function detectRole(sessionName) {
  const nameLower = sessionName.toLowerCase();
  for (const role of ROLE_PREFIXES) {
    if (nameLower.startsWith(role + '-') || nameLower.startsWith(role + '_')) {
      return role;
    }
  }
  if (nameLower.includes('research')) return 'researcher';
  if (nameLower.includes('build')) return 'builder';
  if (nameLower.includes('review')) return 'reviewer';
  if (nameLower.includes('test')) return 'tester';
  return 'unknown';
}

function detectStatus(paneLines) {
  if (!paneLines || paneLines.length === 0) return 'offline';

  const last10 = paneLines.slice(-10).join('\n');
  const last5 = paneLines.slice(-5).join('\n');
  const lastLine = paneLines.filter(l => l.trim()).slice(-1)[0] || '';

  // Codex patterns
  if (/Working \(\d+s/.test(last5)) return 'working';
  if (/Thinking/.test(last5)) return 'thinking';
  if (/esc to interrupt/.test(last5)) return 'working';

  // Claude patterns
  if (/Crunching|crunching/.test(last5)) return 'working';
  if (/◐|◑|◒|◓/.test(last5)) return 'working';  // Spinner
  if (/Running |Ran |Reading |Editing /.test(last5)) return 'working';

  // Gemini patterns
  if (/Generating|Searching|Analyzing/.test(last5)) return 'working';
  if (/✦/.test(last5) && !/\*\s+Type/.test(last5)) return 'working';

  // Error patterns
  if (/error|Error|ERROR|FATAL|panic/.test(lastLine)) return 'error';
  if (/context left/.test(last5)) {
    const match = last5.match(/(\d+)%\s*left/);
    if (match && parseInt(match[1]) < 10) return 'low_context';
  }

  // Idle/ready patterns — agent is at prompt waiting for input
  if (/[›❯>]\s*$/.test(lastLine.trim())) return 'idle';
  if (/\*\s+Type your message/.test(last5)) return 'idle';  // Gemini prompt
  if (/Press enter to confirm/.test(last5)) return 'waiting_approval';
  if (/Yes, proceed|No, and tell/.test(last5)) return 'waiting_approval';

  // MCP loading
  if (/Starting MCP|MCP servers/.test(last5)) return 'loading';

  // Trust prompt
  if (/trust this folder|trust the contents/.test(last10)) return 'waiting_approval';

  // Fallback
  const nonEmpty = paneLines.filter(l => l.trim().length > 0);
  if (nonEmpty.length > 2) return 'running';

  return 'idle';
}

function formatUptime(createdTimestamp) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - createdTimestamp;
  if (diff < 0) return '0s';

  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;

  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function buildSshCommand(tailscaleHost, sessionName) {
  return `ssh ${tailscaleHost} -t "tmux attach -t ${sessionName}"`; // native Windows tmux is on PATH
}

function parseSessionInfo(rawSession, paneLines, tailscaleHost) {
  return {
    name: rawSession.name,
    agentType: detectAgentType(rawSession.name, paneLines),
    role: detectRole(rawSession.name),
    status: detectStatus(paneLines),
    uptime: formatUptime(rawSession.created),
    uptimeSeconds: Math.floor(Date.now() / 1000) - rawSession.created,
    workdir: rawSession.workdir,
    attached: rawSession.attached,
    sshCommand: buildSshCommand(tailscaleHost, rawSession.name),
    lastOutput: paneLines ? paneLines.slice(-30) : []
  };
}

module.exports = {
  detectAgentType,
  detectRole,
  detectStatus,
  formatUptime,
  buildSshCommand,
  parseSessionInfo
};
