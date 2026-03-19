# Agent Dashboard — Handoff

## Project Location
`F:/agent-dashboard/`

## What It Is
Real-time agent management UI that monitors and controls tmux-based AI agent sessions in WSL. Two main tabs: **Sessions** (launch/kill/monitor tmux agents) and **Research** (deploy multi-agent research missions, view compiled reports).

## Stack
- **Backend:** Node.js, Express, WebSocket (`ws`), no database
- **Frontend:** Vanilla HTML/CSS/JS, xterm.js (terminal output), marked.js (markdown rendering)
- **Design System:** VectorHeart — dark industrial theme with cyan (#4A8B94) accents
- **Port:** 3847
- **Research output:** `F:/research/{slug}/` (BRIEF.md + agent .md files)

## How to Run
```bash
cd F:/agent-dashboard && node server.js
# Open http://localhost:3847
```

Kill before restart:
```bash
powershell -Command "Get-NetTCPConnection -LocalPort 3847 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }"
```

## File Structure

```
F:/agent-dashboard/
├── server.js                 # Express + WebSocket server, all WS message routing
├── public/
│   ├── index.html            # Two-tab layout (Sessions + Research), report modal
│   ├── app.js                # Frontend controller — state, cards, report viewer
│   └── style.css             # VectorHeart design system + all component styles
└── src/
    ├── config.js             # PORT, POLL_INTERVAL, TAILSCALE_HOST, AGENTS, PRESETS
    ├── tmux.js               # WSL tmux wrappers (createSession, killSession, capturePane, sendKeys)
    ├── detect.js             # parseSessionInfo — extracts agent type, role, status from pane output
    ├── worktree.js           # detectWorktree — checks if session workdir is a git worktree
    └── research.js           # Research mission lifecycle + report reading + history scanning
```

## Features

### Sessions Tab
- **Preset buttons** — One-click launch for common agent configs (Codex Builder, Opus Builder, etc.)
- **Advanced form** — Custom agent/role/workdir/flags/session name
- **Agent cards** — Live status dot, uptime, workdir, worktree info, SSH command (copy button)
- **Output modes** — OFF / TAIL (plain text) / FULL (xterm.js terminal)
- **Send commands** — Text input to send keystrokes to any session
- **Kill sessions** — With confirmation modal

### Research Tab
- **Research brief form** — Topic (required), scope, focus, ignore, return format
- **Agent selector** — Checkboxes for Codex, Opus, Sonnet, Haiku, Gemini
- **Deploy button** — Creates tmux sessions, writes BRIEF.md, sends research prompt to each agent
- **Mission cards** — Live status chips per agent (pending → launching → waiting_ready → researching → complete)
- **Auto-cleanup** — tmux sessions killed when all agents finish (`checkMissionComplete()`)
- **History persistence** — Old missions from `F:/research/` survive server restarts via `scanHistory()` (30s cache)
- **Scope display** — Shows the mission scope on each card
- **Report viewer** — Click any mission card to open full-viewport report modal

### Report Viewer (NEW — this session)
- **Full-viewport overlay** — Dark background, header with title + status badge + agent tabs + close button
- **Agent tabs** — ALL (compiled view with separators) or individual agent tabs
- **Markdown rendering** — via marked.js v15 CDN, with full VectorHeart-themed styling (headings, code blocks, tables, blockquotes, lists, links)
- **Fallback** — Raw `<pre>` if marked.js fails to load
- **Escape key** — Closes report viewer (priority over confirm modal)
- **"CLICK TO VIEW REPORT"** — Hint text on hoverable mission cards

## WebSocket Messages

### Client → Server
| type | payload | description |
|------|---------|-------------|
| `launch` | agent, role, workdir, sessionName, flags | Launch a new tmux agent session |
| `kill` | session | Kill a tmux session |
| `send` | session, text | Send keystrokes to a session |
| `subscribe` | session, mode (off/tail/full) | Subscribe to session output |
| `research` | topic, scope, focus, ignore, returnFormat, agents[] | Deploy a research mission |
| `kill_mission` | missionId | Abort a running research mission |
| `get_report` | missionId, slug | Request a compiled research report |

### Server → Client
| type | payload | description |
|------|---------|-------------|
| `state` | sessions[] | All active tmux sessions with status |
| `output` | session, lines[] | Session output for subscribed clients |
| `research_state` | missions[] | All missions (active + history from disk) |
| `report` | report { topic, slug, status, brief, scope, agents } | Compiled report with full markdown content |
| `event` | event, data | Notifications (session_created, session_killed, research_deployed, mission_killed, error) |

## Research Mission Lifecycle

```
createMission() → deployAgents() → waitAndSendPrompt() → [agent works] → checkAgentOutputs() → checkMissionComplete()
                                                                                                    ↓
                                                                                            tmux.killSession() per agent
```

1. `createMission()` — Creates output dir at `F:/research/{slug}-{id}/`, writes BRIEF.md, initializes agent states
2. `deployAgents()` — Creates tmux sessions sequentially (2s delay between), handles Gemini's Ctrl+Y
3. `waitAndSendPrompt()` — Polls tmux pane output for agent's `readyIndicator` regex (5s intervals, 2min timeout), then sends research prompt
4. `checkAgentOutputs()` — Called every POLL_INTERVAL (3s), checks if agent .md files exist with >100 bytes
5. `checkMissionComplete()` — When all agents done, marks mission complete/partial, kills all tmux sessions

## Research Report Structure

Each mission outputs to `F:/research/{slug}/`:
```
F:/research/denon-prime-5-intercepting-data-42sr/
├── BRIEF.md        # Research brief with Topic, Scope, Focus, Ignore, Return Format
├── codex.md        # GPT-5.3-Codex findings
├── opus.md         # Claude Opus 4.6 findings (if deployed)
├── sonnet.md       # Claude Sonnet 4.5 findings (if deployed)
├── haiku.md        # Claude Haiku 4.5 findings
└── gemini.md       # Gemini 3 Pro findings (if deployed)
```

### BRIEF.md Format
```markdown
# Research Brief

**Topic:** The topic text
**Scope:** What to look at
**Focus:** What to focus on
**Ignore:** What to skip
**Return Format:**
- Executive summary (2-3 sentences)
- Key findings with details
- Options/approaches (2-3) with tradeoffs
- Recommendation with reasoning
- References and sources
```

## History Scanning (`scanHistory()`)

- Scans `F:/research/` for directories not already in the in-memory missions Map
- Reads BRIEF.md to extract topic and scope
- Checks for known agent files (codex.md, opus.md, sonnet.md, haiku.md, gemini.md)
- Returns history entries with status `"history"` and ID prefix `"history-"`
- 30-second TTL cache to avoid re-scanning on every poll
- History missions appear alongside active missions in the Research tab

## Report Fetching (`getReport()`)

- In-memory missions: reads files from `mission.outputDir`
- History missions (ID starts with `history-`): strips prefix, reads from `F:/research/{slug}/`
- Returns: `{ topic, slug, status, brief, scope, agents: { name: { content, status } } }`

## Agent Config (from `src/config.js`)

| Agent | CLI | Ready Indicator | Notes |
|-------|-----|-----------------|-------|
| codex | `codex-clean.cmd --yolo` | prompt regex | GPT-5.3-Codex |
| opus | `claude-clean.cmd --dangerously-skip-permissions --model claude-opus-4-6` | prompt regex | Claude Opus 4.6 |
| sonnet | `claude-clean.cmd --dangerously-skip-permissions --model claude-sonnet-4-5-20250514` | prompt regex | Claude Sonnet 4.5 |
| haiku | `claude-clean.cmd --dangerously-skip-permissions --model claude-haiku-4-5-20251001` | prompt regex | Claude Haiku 4.5 |
| gemini | `gemini-clean.cmd --yolo` | prompt regex | Gemini 3 Pro, needs Ctrl+Y post-launch |

## What Was Done This Session

1. **Added `getReport()` + `getReportFromDisk()` + `buildReport()`** to `src/research.js` — reads BRIEF.md + agent .md files, returns compiled report object
2. **Added `scanHistory()`** to `src/research.js` — scans `F:/research/` for old missions not in memory, 30s cache
3. **Updated `getMissions()`** — now returns active missions + disk history merged, includes scope field
4. **Added `get_report` WS handler** to `server.js` — routes to `getReport()` or `getReportFromDisk()`
5. **Added report viewer modal** to `index.html` — full-viewport overlay with header, tabs, scrollable body
6. **Added marked.js v15 CDN** to `index.html`
7. **Added ~200 lines of report viewer CSS** to `style.css` — fullscreen overlay, agent tabs, markdown rendering (h1-h6, code, pre, blockquote, table, lists), history badge, clickable mission cards, scope display, view hint
8. **Added report viewer JS** to `app.js` — `requestReport()`, `showReportModal()`, `renderReportContent()`, `hideReport()`, tab switching, mission card click handlers, Escape key handling
9. **Updated mission card rendering** — cards are clickable for viewable missions, show scope, show "CLICK TO VIEW REPORT" hint on hover

## Known State

- Server runs clean on port 3847
- All JS passes syntax check (`node -c`)
- History scanning finds 3 old missions from `F:/research/`
- Report fetching verified for history missions (returns full content with correct topics, scopes, agent outputs)
- tmux session cleanup already works in `checkMissionComplete()` for active missions
- Browser extension was disconnected during this session so visual verification was not completed — needs manual check
