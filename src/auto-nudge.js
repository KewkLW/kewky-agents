/**
 * Auto-nudge — detects idle agents with assigned tasks and
 * sends them a reminder to keep working via tmux send-keys.
 */

const tmux = require('./tmux');

// Track how long each session has been idle
const idleTimers = {};  // { sessionName: { status, since, nudged } }
const IDLE_THRESHOLD = 30000;  // 30 seconds idle before nudge
const NUDGE_COOLDOWN = 120000; // Don't nudge same agent more than once per 2 min

function checkAndNudge(sessions) {
  const now = Date.now();

  for (const session of sessions) {
    const name = session.name;
    const isIdle = ['idle', 'ready'].includes(session.status);
    const isWorking = ['working', 'thinking', 'running'].includes(session.status);

    if (!idleTimers[name]) {
      idleTimers[name] = { status: session.status, since: now, nudged: 0 };
    }

    const timer = idleTimers[name];

    if (isWorking) {
      // Reset idle timer when working
      timer.status = session.status;
      timer.since = now;
      continue;
    }

    if (isIdle) {
      if (timer.status !== session.status || !['idle', 'ready'].includes(timer.status)) {
        // Just became idle
        timer.status = session.status;
        timer.since = now;
      }

      const idleDuration = now - timer.since;
      const sinceLast = now - timer.nudged;

      if (idleDuration > IDLE_THRESHOLD && sinceLast > NUDGE_COOLDOWN) {
        // Nudge this agent
        nudgeAgent(name);
        timer.nudged = now;
        console.log(`// AUTO_NUDGE: ${name} (idle ${Math.round(idleDuration/1000)}s)`);
      }
    }
  }
}

async function nudgeAgent(sessionName) {
  const prompt = 'Continue working on your assigned tasks. If you finished your current task, check your inbox for new assignments: call read_inbox with team_name="soundscape-crew" and your agent name.';
  await tmux.sendKeys(sessionName, prompt);
}

module.exports = { checkAndNudge };
