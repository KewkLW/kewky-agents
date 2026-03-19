import sys, json, os

teams_mcp_path = os.environ.get('TEAMS_MCP_PATH', '')
if teams_mcp_path:
    sys.path.insert(0, os.path.join(teams_mcp_path, 'src'))

from claude_teams import tasks, distributor, messaging
from claude_teams.teams import read_config
from claude_teams.models import TeammateMember

TEAM = os.environ.get('ACTIVE_TEAM', '')
if not TEAM:
    print(json.dumps({"error": "ACTIVE_TEAM not set"}))
    sys.exit(0)

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
