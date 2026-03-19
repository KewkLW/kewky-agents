const fs = require('fs');
const path = require('path');
const tmux = require('./tmux');
const { AGENTS } = require('./config');

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

async function createMission({ topic, scope, focus, ignore, returnFormat, agents }) {
  const id = generateId();
  const slug = slugify(topic);
  const dirName = `${slug}-${id.slice(-4)}`;
  const outputDir = path.join(RESEARCH_DIR, dirName);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

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
    status: 'deploying',
    createdAt: Date.now()
  };

  // Initialize agent states
  for (const agent of agents) {
    mission.agents[agent] = {
      status: 'pending',
      session: `research-${agent}-${id.slice(-4)}`,
      outputFile: path.join(outputDir, `${agent}.md`),
      startedAt: null,
      completedAt: null
    };
  }

  // Write the research brief to the output directory
  const briefContent = buildBrief(mission);
  fs.writeFileSync(path.join(outputDir, 'BRIEF.md'), briefContent);

  missions.set(id, mission);

  // Deploy agents sequentially (avoid WSL overload)
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

  return brief;
}

function buildAgentPrompt(mission, agentName) {
  const agentState = mission.agents[agentName];
  const winOutputPath = agentState.outputFile.replace(/\//g, '/');

  // Keep prompt short for tmux reliability — agent reads the brief from file
  let prompt = `You are a researcher. Read the research brief at ${mission.outputDir.replace(/\\/g, '/')}/BRIEF.md then research the topic thoroughly. `;
  prompt += `Write your complete findings as markdown to: ${winOutputPath.replace(/\\/g, '/')} `;
  prompt += `Include an executive summary, key findings, options with tradeoffs, your recommendation, and references. `;
  prompt += `Write the file when done.`;

  return prompt;
}

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

    // Create tmux session and launch agent
    const workdir = mission.outputDir;
    const ok = await tmux.createSession(agentState.session, workdir, agentConfig.launchCmd);

    if (!ok) {
      agentState.status = 'error';
      agentState.error = 'Failed to create tmux session';
      continue;
    }

    // Handle Gemini's Ctrl+Y confirmation
    if (agentConfig.postLaunch) {
      await new Promise(r => setTimeout(r, 3000));
      await tmux.sendSpecialKey(agentState.session, agentConfig.postLaunch);
    }

    agentState.status = 'waiting_ready';

    // Wait for agent to be ready, then send the research prompt
    waitAndSendPrompt(mission, agentName);

    // Small delay between agent launches to avoid WSL overload
    await new Promise(r => setTimeout(r, 2000));
  }

  mission.status = 'running';
}

async function waitAndSendPrompt(mission, agentName) {
  const agentState = mission.agents[agentName];
  const agentConfig = AGENTS[agentName];
  const maxWait = 120000; // 2 min max wait for ready
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

    const lines = await tmux.capturePane(agentState.session, 30);
    const lastLines = lines.slice(-10).join('\n');

    const isReady = agentConfig.readyIndicator.test(lastLines);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (isReady) {
      agentState.status = 'researching';
      console.log(`// RESEARCH_READY: ${agentName} ready after ${elapsed}s — sending prompt`);
      const prompt = buildAgentPrompt(mission, agentName);
      await tmux.sendKeys(agentState.session, prompt);
    } else {
      if (elapsed % 15 < 5) { // Log every ~15s
        console.log(`// RESEARCH_WAIT: ${agentName} not ready (${elapsed}s elapsed)`);
      }
      setTimeout(check, checkInterval);
    }
  };

  setTimeout(check, 10000); // Initial wait for CLI startup
}

function checkAgentOutputs(mission) {
  let allDone = true;

  for (const [agentName, agentState] of Object.entries(mission.agents)) {
    if (agentState.status === 'researching') {
      // Check if output file exists and has content
      try {
        const stat = fs.statSync(agentState.outputFile);
        if (stat.size > 100) { // At least 100 bytes of content
          agentState.status = 'complete';
          agentState.completedAt = Date.now();
        } else {
          allDone = false;
        }
      } catch {
        allDone = false;
      }
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

  if (allFinished) {
    mission.status = statuses.some(s => s === 'error') ? 'partial' : 'complete';

    // Kill research sessions (cleanup)
    for (const agentState of Object.values(mission.agents)) {
      if (agentState.session) {
        tmux.killSession(agentState.session).catch(() => {});
      }
    }
  }
}

const KNOWN_AGENTS = ['codex', 'opus', 'sonnet', 'haiku', 'gemini'];
let historyCache = null;
let historyCacheTime = 0;
const HISTORY_TTL = 30000; // 30s cache

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

      // Check which agent files exist
      const agents = {};
      for (const agent of KNOWN_AGENTS) {
        const agentFile = path.join(RESEARCH_DIR, d.name, `${agent}.md`);
        if (fs.existsSync(agentFile)) {
          const stat = fs.statSync(agentFile);
          agents[agent] = {
            status: stat.size > 100 ? 'complete' : 'error',
            outputFile: agentFile,
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
  // Try in-memory first
  const mission = missions.get(missionId);
  if (mission) {
    return buildReport(mission.topic, mission.slug, mission.status, mission.outputDir, mission.scope);
  }

  // Try history (slug-based ID)
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

  return { topic, slug, status, brief, scope: scope || '', agents };
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
      await tmux.killSession(agentState.session);
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
