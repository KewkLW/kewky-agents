/**
 * Team Comms — reads agent team mailbox messages for display in the dashboard.
 * Polls ~/.claude/teams/{team}/inboxes/*.json and returns recent messages.
 */

const fs = require('fs');
const path = require('path');

const TEAMS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'teams');

let lastKnownMessages = {};  // { teamName: { agentName: messageCount } }

function getActiveTeams() {
  try {
    if (!fs.existsSync(TEAMS_DIR)) return [];
    return fs.readdirSync(TEAMS_DIR).filter(d => {
      const configPath = path.join(TEAMS_DIR, d, 'config.json');
      return fs.existsSync(configPath);
    });
  } catch {
    return [];
  }
}

function readTeamConfig(teamName) {
  try {
    const configPath = path.join(TEAMS_DIR, teamName, 'config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function readInbox(teamName, agentName) {
  try {
    const inboxPath = path.join(TEAMS_DIR, teamName, 'inboxes', `${agentName}.json`);
    if (!fs.existsSync(inboxPath)) return [];
    return JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
  } catch {
    return [];
  }
}

function getAllComms() {
  const teams = getActiveTeams();
  const result = {
    teams: [],
    feed: [],  // Global chronological feed
    newMessages: []  // Messages since last poll
  };

  for (const teamName of teams) {
    const config = readTeamConfig(teamName);
    if (!config) continue;

    const teamData = {
      name: teamName,
      members: [],
      messageCount: 0
    };

    const memberNames = (config.members || []).map(m => m.name);

    for (const memberName of memberNames) {
      const messages = readInbox(teamName, memberName);
      const recent = messages.slice(-10);  // Last 10 per agent

      teamData.members.push({
        name: memberName,
        totalMessages: messages.length,
        unreadCount: messages.filter(m => !m.read).length,
        recentMessages: recent.map(m => formatMessage(m, memberName))
      });
      teamData.messageCount += messages.length;

      // Add to global feed
      for (const msg of messages) {
        result.feed.push({
          team: teamName,
          to: memberName,
          from: msg.from,
          text: parseMessageText(msg.text),
          timestamp: msg.timestamp,
          read: msg.read,
          color: msg.color
        });
      }

      // Check for new messages since last poll
      const prevCount = (lastKnownMessages[teamName] || {})[memberName] || 0;
      if (messages.length > prevCount) {
        const newMsgs = messages.slice(prevCount);
        for (const msg of newMsgs) {
          result.newMessages.push({
            team: teamName,
            to: memberName,
            from: msg.from,
            text: parseMessageText(msg.text),
            timestamp: msg.timestamp,
            color: msg.color
          });
        }
      }

      // Update tracking
      if (!lastKnownMessages[teamName]) lastKnownMessages[teamName] = {};
      lastKnownMessages[teamName][memberName] = messages.length;
    }

    result.teams.push(teamData);
  }

  // Sort feed by timestamp (newest first)
  result.feed.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  result.feed = result.feed.slice(0, 50);  // Cap at 50

  return result;
}

function formatMessage(msg, recipient) {
  return {
    from: msg.from,
    to: recipient,
    text: parseMessageText(msg.text),
    timestamp: msg.timestamp,
    read: msg.read,
    color: msg.color
  };
}

function parseMessageText(text) {
  if (!text) return '';
  // Try to parse JSON-in-JSON protocol messages
  try {
    const parsed = JSON.parse(text);
    if (parsed.type === 'task_assignment') {
      return `[TASK] ${parsed.subject}`;
    }
    if (parsed.type === 'shutdown_request') {
      return `[SHUTDOWN] ${parsed.reason || 'requested'}`;
    }
    if (parsed.type === 'idle_notification') {
      return `[IDLE] ${parsed.idleReason || 'available'}`;
    }
    return text.slice(0, 200);
  } catch {
    // Plain text message — strip system reminders
    const cleaned = text.replace(/<system_reminder>[\s\S]*?<\/system_reminder>/g, '').trim();
    return cleaned.slice(0, 200);
  }
}

module.exports = { getAllComms, getActiveTeams, readTeamConfig };
