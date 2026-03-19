/**
 * Auto-distributor — polls the team task/inbox state and
 * automatically distributes ready tasks to available agents.
 * Runs as part of the dashboard poll loop.
 */

const { execSync } = require('child_process');
const path = require('path');

const DISTRIBUTOR_SCRIPT = `
import sys
sys.path.insert(0, 'F:/claude-code-teams-mcp/src')
from claude_teams import tasks, distributor, messaging
from claude_teams.teams import read_config
from claude_teams.models import TeammateMember
import json

TEAM = 'soundscape-crew'

try:
    config = read_config(TEAM)
except:
    print(json.dumps({"error": "no team"}))
    sys.exit(0)

# Check for completed task notifications in team-lead inbox
lead_msgs = messaging.read_inbox(TEAM, 'team-lead', unread_only=True, mark_as_read=True)
for msg in lead_msgs:
    try:
        # Log it
        pass
    except:
        pass

# Find and distribute ready tasks
try:
    assignments = distributor.distribute_tasks(TEAM)
    result = {
        "assignments": [{"task_id": a["task_id"], "subject": a["subject"], "agent": a["agent_name"]} for a in assignments],
        "pending": len([t for t in tasks.list_tasks(TEAM) if t.status == "pending"]),
        "in_progress": len([t for t in tasks.list_tasks(TEAM) if t.status == "in_progress"]),
        "completed": len([t for t in tasks.list_tasks(TEAM) if t.status == "completed"]),
    }
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

let lastDistributeTime = 0;
const DISTRIBUTE_INTERVAL = 15000; // Every 15 seconds

function autoDistribute() {
  const now = Date.now();
  if (now - lastDistributeTime < DISTRIBUTE_INTERVAL) return null;
  lastDistributeTime = now;

  try {
    const result = execSync(`python -c "${DISTRIBUTOR_SCRIPT.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      cwd: 'F:/claude-code-teams-mcp'
    });
    return JSON.parse(result.trim());
  } catch (err) {
    return null;
  }
}

// Simpler approach — just run the Python script as a file
function runDistributor() {
  const now = Date.now();
  if (now - lastDistributeTime < DISTRIBUTE_INTERVAL) return null;
  lastDistributeTime = now;

  try {
    const result = execSync('python F:/agent-dashboard/src/distribute-tick.py', {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true
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
