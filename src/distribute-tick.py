import sys, json
sys.path.insert(0, 'F:/claude-code-teams-mcp/src')

from claude_teams import tasks, distributor, messaging
from claude_teams.teams import read_config
from claude_teams.models import TeammateMember

TEAM = 'soundscape-crew'

try:
    config = read_config(TEAM)
except:
    print(json.dumps({"error": "no team"}))
    sys.exit(0)

# Read and acknowledge team-lead inbox
try:
    lead_msgs = messaging.read_inbox(TEAM, 'team-lead', unread_only=True, mark_as_read=True)
except:
    lead_msgs = []

# Distribute any ready tasks
try:
    assignments = distributor.distribute_tasks(TEAM)
except:
    assignments = []

# Get task stats
try:
    all_tasks = tasks.list_tasks(TEAM)
    result = {
        "assignments": [
            {"task_id": a["task_id"], "subject": a["subject"], "agent": a["agent_name"]}
            for a in assignments
        ],
        "lead_messages": len(lead_msgs),
        "pending": len([t for t in all_tasks if t.status == "pending"]),
        "in_progress": len([t for t in all_tasks if t.status == "in_progress"]),
        "completed": len([t for t in all_tasks if t.status == "completed"]),
    }
except Exception as e:
    result = {"error": str(e)}

print(json.dumps(result))
