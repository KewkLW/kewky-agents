const fs = require('fs');
const path = require('path');
const sessions = require('./sessions');
const { AGENTS } = require('./config');
const { detectStatus } = require('./detect');

const RESEARCH_DIR = process.env.RESEARCH_DIR || path.join(__dirname, '..', 'research-output');
const missions = new Map();

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ============================================
// ANGLE ASSIGNMENT
// ============================================

const ANGLE_POOL = [
  'technical implementation and how it works',
  'alternatives, competitors, and ecosystem',
  'risks, limitations, and practical considerations',
  'ecosystem, community, and adoption',
  'performance, benchmarks, and scalability',
  'security implications and threat model',
  'cost, pricing, and resource requirements'
];

function assignAngles(agentNames) {
  const count = agentNames.length;
  const angles = {};

  if (count === 1) {
    angles[agentNames[0]] = 'comprehensive research covering all aspects';
  } else if (count === 2) {
    angles[agentNames[0]] = 'technical deep-dive and implementation details';
    angles[agentNames[1]] = 'alternatives, comparisons, and tradeoffs';
  } else if (count === 3) {
    angles[agentNames[0]] = 'technical implementation and how it works';
    angles[agentNames[1]] = 'alternatives, competitors, and ecosystem';
    angles[agentNames[2]] = 'risks, limitations, and practical considerations';
  } else {
    for (let i = 0; i < count; i++) {
      angles[agentNames[i]] = ANGLE_POOL[i % ANGLE_POOL.length];
    }
  }

  return angles;
}

// ============================================
// MISSION CREATION
// ============================================

async function createMission({ topic, scope, focus, ignore, returnFormat, agents }) {
  const id = generateId();
  const slug = slugify(topic);
  const dirName = `${slug}-${id.slice(-4)}`;
  const outputDir = path.join(RESEARCH_DIR, dirName);

  fs.mkdirSync(outputDir, { recursive: true });

  const angles = assignAngles(agents);

  const mission = {
    id,
    topic,
    scope: scope || '',
    focus: focus || '',
    ignore: ignore || '',
    returnFormat: returnFormat || '',
    slug: dirName,
    outputDir,
    agents: {},
    angles,
    status: 'deploying',
    createdAt: Date.now()
  };

  for (const agent of agents) {
    mission.agents[agent] = {
      status: 'pending',
      session: `research-${agent}-${id.slice(-4)}`,
      outputFile: path.join(outputDir, `${agent}.md`),
      angle: angles[agent] || '',
      startedAt: null,
      completedAt: null
    };
  }

  // Write the research brief
  const briefContent = buildBrief(mission);
  fs.writeFileSync(path.join(outputDir, 'BRIEF.md'), briefContent);

  missions.set(id, mission);
  deployAgents(mission);

  return mission;
}

function buildBrief(mission) {
  let brief = `# Research Brief\n\n`;
  brief += `**Topic:** ${mission.topic}\n\n`;

  if (mission.scope) brief += `**Scope:** ${mission.scope}\n\n`;
  if (mission.focus) brief += `**Focus:** ${mission.focus}\n\n`;
  if (mission.ignore) brief += `**Ignore:** ${mission.ignore}\n\n`;

  if (mission.returnFormat) {
    brief += `**Return Format:** ${mission.returnFormat}\n\n`;
  } else {
    brief += `**Return Format:**\n`;
    brief += `- Executive summary (2-3 sentences)\n`;
    brief += `- Key findings with details\n`;
    brief += `- Options/approaches (2-3) with tradeoffs if applicable\n`;
    brief += `- Recommendation with reasoning\n`;
    brief += `- References and sources\n\n`;
  }

  // Document angle assignments
  const agentNames = Object.keys(mission.agents);
  if (agentNames.length > 1) {
    brief += `**Agent Assignments:**\n`;
    for (const name of agentNames) {
      brief += `- ${name}: ${mission.angles[name]}\n`;
    }
    brief += '\n';
  }

  return brief;
}

// ============================================
// AGENT PROMPTS
// ============================================

function buildAgentPrompt(mission, agentName) {
  const agentState = mission.agents[agentName];
  const outputPath = agentState.outputFile.replace(/\\/g, '/');
  const angle = agentState.angle || 'comprehensive research';

  let prompt = `Research this topic: "${mission.topic}"`;

  if (mission.scope) prompt += `\nScope: ${mission.scope}`;
  if (mission.focus) prompt += `\nFocus: ${mission.focus}`;
  if (mission.ignore) prompt += `\nIgnore: ${mission.ignore}`;

  const agentCount = Object.keys(mission.agents).length;
  if (agentCount > 1) {
    prompt += `\n\nYour assigned angle: ${angle}. Other agents are covering different angles, so focus specifically on yours.`;
  }

  prompt += `\n\nUse web search if available. Cite sources with URLs when possible.`;

  if (mission.returnFormat) {
    prompt += `\nOutput format: ${mission.returnFormat}`;
  } else {
    prompt += `\nInclude: executive summary, key findings, options with tradeoffs, recommendation, and references.`;
  }

  prompt += `\nWrite your complete findings as markdown to: ${outputPath}`;

  return prompt;
}

// ============================================
// AGENT DEPLOYMENT
// ============================================

async function deployAgents(mission) {
  const agentNames = Object.keys(mission.agents);

  for (const agentName of agentNames) {
    const agentState = mission.agents[agentName];
    const agentConfig = AGENTS[agentName];

    if (!agentConfig) {
      agentState.status = 'error';
      agentState.error = `Unknown agent: ${agentName}`;
      continue;
    }

    agentState.status = 'launching';
    agentState.startedAt = Date.now();

    const workdir = mission.outputDir;
    const ok = sessions.create(agentState.session, agentConfig.launchCmd, {
      cwd: workdir,
      env: agentConfig.env
    });

    if (!ok) {
      agentState.status = 'error';
      agentState.error = 'Failed to create session';
      continue;
    }

    // Handle Gemini's Ctrl+Y confirmation
    if (agentConfig.postLaunch) {
      await new Promise(r => setTimeout(r, 3000));
      sessions.write(agentState.session, agentConfig.postLaunch);
    }

    agentState.status = 'waiting_ready';
    waitAndSendPrompt(mission, agentName);

    // Small delay between agent launches
    await new Promise(r => setTimeout(r, 2000));
  }

  mission.status = 'running';
}

async function waitAndSendPrompt(mission, agentName) {
  const agentState = mission.agents[agentName];
  const agentConfig = AGENTS[agentName];
  const maxWait = 120000;
  const checkInterval = 5000;
  const startTime = Date.now();

  const check = async () => {
    if (Date.now() - startTime > maxWait) {
      agentState.status = 'error';
      agentState.error = 'Timed out waiting for agent ready (2min)';
      console.error(`// RESEARCH_TIMEOUT: ${agentName} never matched readyIndicator`);
      checkMissionComplete(mission);
      return;
    }

    const lines = sessions.getOutput(agentState.session, 30);
    const lastLines = lines.slice(-10).join('\n');

    const isReady = agentConfig.readyIndicator.test(lastLines);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (isReady) {
      agentState.status = 'researching';
      console.log(`// RESEARCH_READY: ${agentName} ready after ${elapsed}s — sending prompt`);
      const prompt = buildAgentPrompt(mission, agentName);
      sessions.write(agentState.session, prompt + '\r');
    } else {
      if (elapsed % 15 < 5) {
        console.log(`// RESEARCH_WAIT: ${agentName} not ready (${elapsed}s elapsed)`);
      }
      setTimeout(check, checkInterval);
    }
  };

  setTimeout(check, 10000);
}

// ============================================
// COMPLETION DETECTION
// ============================================

function checkAgentOutputs(mission) {
  let allDone = true;

  for (const [agentName, agentState] of Object.entries(mission.agents)) {
    if (agentState.status === 'researching') {
      let fileExists = false;
      let fileSize = 0;

      try {
        const stat = fs.statSync(agentState.outputFile);
        fileExists = true;
        fileSize = stat.size;
      } catch {}

      // Primary check: file has substantial content
      if (fileExists && fileSize > 200) {
        agentState.status = 'complete';
        agentState.completedAt = Date.now();
        continue;
      }

      // Secondary check: agent session is idle AND file exists with some content
      if (fileExists && fileSize > 200) {
        agentState.status = 'complete';
        agentState.completedAt = Date.now();
        continue;
      }

      // Tertiary: check session status — if idle and file has content, it's done
      if (fileExists && fileSize > 100) {
        try {
          const paneLines = sessions.getOutput(agentState.session, 10);
          const sessionStatus = detectStatus(paneLines);
          if (sessionStatus === 'idle') {
            agentState.status = 'complete';
            agentState.completedAt = Date.now();
            continue;
          }
        } catch {}
      }

      allDone = false;
    } else if (agentState.status !== 'complete' && agentState.status !== 'error') {
      allDone = false;
    }
  }

  if (allDone) {
    checkMissionComplete(mission);
  }
}

function checkMissionComplete(mission) {
  const statuses = Object.values(mission.agents).map(a => a.status);
  const allFinished = statuses.every(s => s === 'complete' || s === 'error');

  if (!allFinished) return;

  // Kill research sessions (cleanup)
  for (const agentState of Object.values(mission.agents)) {
    if (agentState.session) {
      sessions.kill(agentState.session);
    }
  }

  const completedCount = statuses.filter(s => s === 'complete').length;

  // Auto-synthesis: if 2+ agents completed, synthesize
  if (completedCount >= 2) {
    mission.status = 'synthesizing';
    runSynthesis(mission);
  } else {
    mission.status = statuses.some(s => s === 'error') ? 'partial' : 'complete';
  }
}

// ============================================
// AUTO-SYNTHESIS
// ============================================

async function runSynthesis(mission) {
  // Pick synthesis agent: prefer haiku, then any claude agent
  let synthAgent = null;
  for (const name of ['haiku', 'sonnet', 'opus']) {
    if (AGENTS[name]) { synthAgent = name; break; }
  }

  if (!synthAgent) {
    console.error('// SYNTHESIS_ERROR: No claude agent available for synthesis');
    mission.status = 'complete';
    return;
  }

  const agentConfig = AGENTS[synthAgent];
  const synthSession = `synthesis-${mission.id.slice(-4)}`;
  const synthOutputFile = path.join(mission.outputDir, 'SYNTHESIS.md');

  console.log(`// SYNTHESIS_START: ${synthAgent} synthesizing ${Object.keys(mission.agents).length} reports`);

  const ok = sessions.create(synthSession, agentConfig.launchCmd, {
    cwd: mission.outputDir,
    env: agentConfig.env
  });

  if (!ok) {
    console.error('// SYNTHESIS_ERROR: Failed to create synthesis session');
    mission.status = 'complete';
    return;
  }

  if (agentConfig.postLaunch) {
    await new Promise(r => setTimeout(r, 3000));
    sessions.write(synthSession, agentConfig.postLaunch);
  }

  // Wait for agent ready
  const maxWait = 120000;
  const startTime = Date.now();

  const waitReady = async () => {
    if (Date.now() - startTime > maxWait) {
      console.error('// SYNTHESIS_TIMEOUT: agent never became ready');
      sessions.kill(synthSession);
      mission.status = 'complete';
      return;
    }

    const lines = sessions.getOutput(synthSession, 30);
    const lastLines = lines.slice(-10).join('\n');

    if (agentConfig.readyIndicator.test(lastLines)) {
      // Build synthesis prompt
      const agentFiles = Object.entries(mission.agents)
        .filter(([, s]) => s.status === 'complete')
        .map(([name, s]) => {
          const filePath = s.outputFile.replace(/\\/g, '/');
          const angle = s.angle || 'general';
          return `- ${name} (angle: ${angle}): ${filePath}`;
        })
        .join('\n');

      const synthPrompt = `You are synthesizing research from multiple agents on: "${mission.topic}"

Read these agent reports:
${agentFiles}

Produce a unified synthesis report that:
1. Combines key findings from all agents
2. Removes duplicate information
3. Resolves any contradictions between reports
4. Organizes into a coherent structure with executive summary, findings, recommendations
5. Credits which agent(s) contributed each finding

Write the synthesis as markdown to: ${synthOutputFile.replace(/\\/g, '/')}`;

      sessions.write(synthSession, synthPrompt + '\r');
      console.log(`// SYNTHESIS_PROMPT_SENT: ${synthAgent}`);

      // Poll for synthesis completion
      pollSynthesis(mission, synthSession, synthOutputFile);
    } else {
      setTimeout(waitReady, 5000);
    }
  };

  setTimeout(waitReady, 10000);
}

function pollSynthesis(mission, synthSession, synthOutputFile) {
  const startTime = Date.now();
  const maxWait = 300000; // 5 min max for synthesis

  const check = () => {
    if (Date.now() - startTime > maxWait) {
      console.error('// SYNTHESIS_TIMEOUT: took too long');
      sessions.kill(synthSession);
      mission.status = 'complete';
      return;
    }

    try {
      const stat = fs.statSync(synthOutputFile);
      if (stat.size > 200) {
        // Also check if agent is idle (done writing)
        const paneLines = sessions.getOutput(synthSession, 10);
        const sessionStatus = detectStatus(paneLines);
        if (sessionStatus === 'idle' || stat.size > 500) {
          console.log(`// SYNTHESIS_COMPLETE: ${stat.size} bytes`);
          sessions.kill(synthSession);
          mission.status = 'complete';
          return;
        }
      }
    } catch {}

    setTimeout(check, 10000);
  };

  setTimeout(check, 15000);
}

// ============================================
// HISTORY & REPORTING
// ============================================

const KNOWN_AGENTS = ['codex', 'codex-primary', 'codex-alt', 'codex-nano', 'codex-mini', 'opus', 'sonnet', 'haiku', 'gemini'];
let historyCache = null;
let historyCacheTime = 0;
const HISTORY_TTL = 30000;

function scanHistory() {
  const now = Date.now();
  if (historyCache && (now - historyCacheTime) < HISTORY_TTL) return historyCache;

  const inMemorySlugs = new Set(Array.from(missions.values()).map(m => m.slug));
  const history = [];

  try {
    const dirs = fs.readdirSync(RESEARCH_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      if (inMemorySlugs.has(d.name)) continue;

      const briefPath = path.join(RESEARCH_DIR, d.name, 'BRIEF.md');
      if (!fs.existsSync(briefPath)) continue;

      const brief = fs.readFileSync(briefPath, 'utf-8');
      const topicMatch = brief.match(/\*\*Topic:\*\*\s*(.+)/);
      const scopeMatch = brief.match(/\*\*Scope:\*\*\s*(.+)/);
      const topic = topicMatch ? topicMatch[1].trim() : d.name;
      const scope = scopeMatch ? scopeMatch[1].trim() : '';

      const agents = {};
      for (const agent of KNOWN_AGENTS) {
        const agentFile = path.join(RESEARCH_DIR, d.name, `${agent}.md`);
        if (fs.existsSync(agentFile)) {
          const stat = fs.statSync(agentFile);
          agents[agent] = {
            status: stat.size > 100 ? 'complete' : 'error',
            outputFile: agentFile,
            angle: '',
            startedAt: null,
            completedAt: stat.mtimeMs
          };
        }
      }

      if (Object.keys(agents).length === 0) continue;

      history.push({
        id: `history-${d.name}`,
        topic,
        scope,
        slug: d.name,
        outputDir: path.join(RESEARCH_DIR, d.name),
        status: 'history',
        createdAt: fs.statSync(briefPath).mtimeMs,
        agents
      });
    }
  } catch (err) {
    console.error('// HISTORY_SCAN_ERROR:', err.message);
  }

  historyCache = history;
  historyCacheTime = now;
  return history;
}

function getMissions() {
  const active = Array.from(missions.values()).map(m => ({
    id: m.id,
    topic: m.topic,
    scope: m.scope || '',
    slug: m.slug,
    outputDir: m.outputDir,
    status: m.status,
    createdAt: m.createdAt,
    agents: Object.fromEntries(
      Object.entries(m.agents).map(([name, state]) => [name, {
        status: state.status,
        session: state.session,
        outputFile: state.outputFile,
        angle: state.angle || '',
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        error: state.error
      }])
    )
  }));

  const history = scanHistory();
  return [...active, ...history];
}

function getReport(missionId) {
  const mission = missions.get(missionId);
  if (mission) {
    return buildReport(mission.topic, mission.slug, mission.status, mission.outputDir, mission.scope);
  }

  if (missionId.startsWith('history-')) {
    const slug = missionId.replace('history-', '');
    return getReportFromDisk(slug);
  }

  return null;
}

function getReportFromDisk(slug) {
  const dir = path.join(RESEARCH_DIR, slug);
  if (!fs.existsSync(dir)) return null;

  const briefPath = path.join(dir, 'BRIEF.md');
  if (!fs.existsSync(briefPath)) return null;

  const brief = fs.readFileSync(briefPath, 'utf-8');
  const topicMatch = brief.match(/\*\*Topic:\*\*\s*(.+)/);
  const scopeMatch = brief.match(/\*\*Scope:\*\*\s*(.+)/);
  const topic = topicMatch ? topicMatch[1].trim() : slug;
  const scope = scopeMatch ? scopeMatch[1].trim() : '';

  return buildReport(topic, slug, 'history', dir, scope);
}

function buildReport(topic, slug, status, outputDir, scope) {
  let brief = '';
  const briefPath = path.join(outputDir, 'BRIEF.md');
  if (fs.existsSync(briefPath)) {
    brief = fs.readFileSync(briefPath, 'utf-8');
  }

  const agents = {};
  for (const agent of KNOWN_AGENTS) {
    const agentFile = path.join(outputDir, `${agent}.md`);
    if (fs.existsSync(agentFile)) {
      try {
        const content = fs.readFileSync(agentFile, 'utf-8');
        agents[agent] = {
          content,
          status: content.length > 100 ? 'complete' : 'partial'
        };
      } catch {
        agents[agent] = { content: '', status: 'error' };
      }
    }
  }

  // Include synthesis if it exists
  let synthesis = null;
  const synthFile = path.join(outputDir, 'SYNTHESIS.md');
  if (fs.existsSync(synthFile)) {
    try {
      synthesis = fs.readFileSync(synthFile, 'utf-8');
    } catch {}
  }

  return { topic, slug, status, brief, scope: scope || '', agents, synthesis };
}

function pollMissions() {
  for (const mission of missions.values()) {
    if (mission.status === 'running' || mission.status === 'deploying') {
      checkAgentOutputs(mission);
    }
  }
}

async function killMission(missionId) {
  const mission = missions.get(missionId);
  if (!mission) return false;

  for (const agentState of Object.values(mission.agents)) {
    if (agentState.status !== 'complete' && agentState.status !== 'error') {
      agentState.status = 'killed';
      sessions.kill(agentState.session);
    }
  }

  mission.status = 'killed';
  return true;
}

module.exports = {
  createMission,
  getMissions,
  pollMissions,
  killMission,
  getReport,
  getReportFromDisk,
  RESEARCH_DIR
};
