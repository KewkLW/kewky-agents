/**
 * Auto-distributor — polls the team task/inbox state and
 * automatically distributes ready tasks to available agents.
 * Runs as part of the dashboard poll loop.
 */

const { execSync } = require('child_process');
const path = require('path');
const { ACTIVE_TEAM, TEAMS_MCP_PATH } = require('./config');

let lastDistributeTime = 0;
const DISTRIBUTE_INTERVAL = 15000; // Every 15 seconds

// Simpler approach — just run the Python script as a file
function runDistributor() {
  if (!ACTIVE_TEAM || !TEAMS_MCP_PATH) return null;

  const now = Date.now();
  if (now - lastDistributeTime < DISTRIBUTE_INTERVAL) return null;
  lastDistributeTime = now;

  const scriptPath = path.join(__dirname, 'distribute-tick.py');

  try {
    const result = execSync(`python "${scriptPath}"`, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      env: {
        ...process.env,
        ACTIVE_TEAM,
        TEAMS_MCP_PATH
      }
    });
    const parsed = JSON.parse(result.trim());
    if (parsed.assignments && parsed.assignments.length > 0) {
      console.log(`// AUTO_DISTRIBUTE: ${parsed.assignments.length} tasks assigned`);
      for (const a of parsed.assignments) {
        console.log(`//   Task ${a.task_id}: ${a.subject.slice(0, 40)} -> ${a.agent}`);
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

module.exports = { runDistributor };
