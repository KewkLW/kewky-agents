# Agent Dashboard — Implementation Plan

**Goal:** Real-time web UI to monitor, launch, kill, and interact with WSL tmux agent sessions.
**Architecture:** Node.js backend polls tmux via `wsl bash -c`, pushes state diffs over WebSocket to a vanilla JS frontend styled with VectorHeart industrial dark theme.
**Tech Stack:** Node.js 20+, Express 4, ws 8, xterm.js 5 (optional), vanilla JS/CSS
**Port:** 3847
**Conventions:** camelCase functions, UPPER_SNAKE config constants, monospace UI, all WSL calls use `timeout` wrapper, no tight polling (<3s)
**Out of scope:** Authentication, persistent storage, multi-machine support, agent prompt templates/injection

---

## VectorHeart Design Tokens

```
BG_PRIMARY:     #1E2830    // dark blue-gray base
BG_SURFACE:     #243040    // card/panel surface
BG_DEEP:        #1A1A1A    // structure black, deepest layer
BORDER:         #2A3545    // subtle grid lines
CYAN:           #4A8B94    // primary accent, headings, active states
ORANGE:         #FF4500    // alerts, kill, hot accent
WHITE:          #FFFFFF    // primary text
TEXT_DIM:       #8A9BAE    // secondary text, labels
TEXT_MONO:      #C8D6E5    // monospace output text
FONT_MONO:      'JetBrains Mono', 'Fira Code', 'Consolas', monospace
FONT_HEADING:   uppercase, letter-spacing 0.1em, font-weight 700
LABEL_STYLE:    "// UPPERCASE_WITH_UNDERSCORES"
SCALE:          1.618 (golden ratio for spacing/sizing)
```

---

## WebSocket Protocol

### Server → Client

```jsonc
// Full state push (on connect + every 3s)
{ "type": "state", "sessions": [
  {
    "name": "builder-t3",
    "agentType": "codex",        // opus|sonnet|haiku|codex|gemini
    "role": "builder",           // builder|researcher|reviewer|tester|deslop|unknown
    "status": "running",         // running|idle|ready|dead
    "uptime": 342,               // seconds
    "workdir": "/mnt/f/project",
    "worktree": { "path": ".worktrees/t3-auth", "branch": "godmode/t3-auth" },
    "sshCommand": "ssh wsl-kewkd -t \"tmux attach -t builder-t3\"",
    "lastOutput": ["line1", "line2", "..."]  // last N lines if output mode is tail
  }
]}

// Output stream (when subscribed to tail/full mode)
{ "type": "output", "session": "builder-t3", "lines": ["new line..."] }

// Event notifications
{ "type": "event", "event": "session_created"|"session_killed"|"error", "data": {...} }
```

### Client → Server

```jsonc
{ "type": "launch", "agent": "codex", "role": "builder", "workdir": "/mnt/f/project", "sessionName": "builder-t3", "flags": "--yolo" }
{ "type": "kill", "session": "builder-t3" }
{ "type": "send", "session": "builder-t3", "text": "implement the auth module" }
{ "type": "subscribe", "session": "builder-t3", "mode": "tail"|"full"|"off" }
```

---

## Execution Waves

**Wave 0:** T0 (scaffold) — no deps
**Wave 1:** T1, T2, T3 — depend on T0 only, parallel (3 agents)
**Wave 2:** T4, T5 — T4 depends on T1+T2+T3; T5 depends on T0 only (parallel: T5 is frontend-only)
**Wave 3:** T6 — depends on T4+T5 (integration)
**Wave 4:** T7 — depends on T6 (polish + xterm.js)

---

### Task 0: Scaffold & Project Setup
**Agent:** Direct (conductor)
**Files:** create `F:/agent-dashboard/package.json`, create `F:/agent-dashboard/.gitignore`, create dirs
**Depends on:** none
**Wave:** 0

**Build:**
1. Create `F:/agent-dashboard/` directory structure: `src/`, `public/`
2. Create `package.json` with name "agent-dashboard", deps: express@4, ws@8
3. Create `.gitignore` with node_modules
4. Run `npm install`
5. Create empty placeholder files for all source files

**Constraints:**
- No devDependencies needed — vanilla JS, no build step

**Verify:**
- `node -e "require('express'); require('ws'); console.log('OK')"` in project dir

---

### Task 1: TMux Interface Module
**Agent:** Codex WSL
**Files:** create `F:/agent-dashboard/src/tmux.js`
**Depends on:** T0
**Wave:** 1

**Build:**
1. Create `src/tmux.js` exporting these functions:
2. `listSessions()` — runs `wsl bash -c "tmux ls -F '#{session_name}|#{session_created}|#{session_attached}|#{pane_current_path}'"`, parses into array of `{ name, created, attached, workdir }`
3. `capturePane(sessionName, lines=30)` — runs `wsl bash -c "tmux capture-pane -t <name> -p -S -<lines>"`, returns array of strings
4. `killSession(sessionName)` — runs `wsl bash -c "tmux kill-session -t <name>"`, returns boolean success
5. `sendKeys(sessionName, text)` — sends text then Enter as two separate calls (matching existing pattern): `tmux send-keys -t <name> '<escaped>'` then `tmux send-keys -t <name> Enter`
6. `createSession(name, workdir, command)` — runs `tmux new-session -d -s <name> -c <workdir>` then `tmux send-keys -t <name> '<command>' Enter`
7. All functions use `child_process.execSync` with `{ timeout: 10000 }` for safety
8. All WSL calls prefixed with `wsl bash -c` and proper quote escaping
9. Export a helper `wslExec(cmd, timeoutMs=10000)` that wraps the spawn pattern

**Constraints:**
- Single quotes in tmux send-keys must be escaped: `'\''`
- Never use `tmux has-session` (leaks WSL processes per MEMORY.md)
- All errors caught and returned as null/false, not thrown

**Verify:**
- `node -e "const t = require('./src/tmux'); console.log(typeof t.listSessions)"` prints "function"
- Module loads without error

---

### Task 2: Agent Detection Module
**Agent:** Codex WSL
**Files:** create `F:/agent-dashboard/src/detect.js`
**Depends on:** T0
**Wave:** 1

**Build:**
1. Create `src/detect.js` exporting these functions:
2. `detectAgentType(sessionName, paneContent)` — returns "opus"|"sonnet"|"haiku"|"codex"|"gemini"|"unknown"
   - First check session name for agent keywords
   - Then check pane content for CLI indicators: Claude shows "claude-opus-4-6" etc in startup, Codex shows "codex" prompt, Gemini shows "gemini" prompt
3. `detectRole(sessionName)` — returns "builder"|"researcher"|"reviewer"|"tester"|"deslop"|"unknown"
   - Parse prefix: `builder-*`, `researcher-*`, `reviewer-*`, `tester-*`, `deslop-*`
4. `detectStatus(paneLines)` — returns "running"|"idle"|"ready"
   - Check last 3 lines for ready indicators: `Try "edit"` (Claude ready), `>` or `›` (Codex/Gemini ready)
   - If ready indicator found → "ready"
   - If recent output (non-empty last lines) → "running"
   - Else → "idle"
5. `buildSshCommand(tailscaleHost, sessionName)` — returns `ssh <host> -t "tmux attach -t <name>"`
6. `parseSessionInfo(rawSession, paneContent, tailscaleHost)` — combines all detection into one structured object

**Constraints:**
- Pure functions, no side effects, no WSL calls
- Case-insensitive matching on agent names

**Verify:**
- `detectRole("builder-t3")` returns "builder"
- `detectAgentType("opus-research", [])` returns "opus"
- `detectStatus(["", "", "Try \"edit\""])` returns "ready"

---

### Task 3: Worktree + Config Module
**Agent:** Codex WSL
**Files:** create `F:/agent-dashboard/src/worktree.js`, create `F:/agent-dashboard/src/config.js`
**Depends on:** T0
**Wave:** 1

**Build:**
1. Create `src/config.js`:
   - `PORT = 3847`
   - `POLL_INTERVAL = 3000` (ms)
   - `TAILSCALE_HOST = "wsl-kewkd"` (configurable via env var `TAILSCALE_HOST`)
   - `AGENTS` map: { opus, sonnet, haiku, codex, gemini } each with: model, launchCmd (Windows .cmd path), readyIndicator, flags
   - `PRESETS` array: common role+agent combos for quick-launch buttons
     - "Codex Builder", "Opus Builder", "Haiku Researcher", "Gemini Builder", "Codex Reviewer", "Sonnet Builder"
     - Each preset: { label, agent, role, defaultFlags }
   - `LAUNCH_COMMANDS` — map agent type to the full `cmd.exe /c "..."` launch string template

2. Create `src/worktree.js`:
   - `detectWorktree(workdir)` — runs `wsl bash -c "cd <workdir> && git worktree list --porcelain 2>/dev/null"`, parses output
   - Returns `{ path, branch }` if session workdir is inside a worktree, null otherwise
   - Parse porcelain format: lines starting with `worktree`, `HEAD`, `branch`

**Constraints:**
- Config values overridable via environment variables where sensible
- Worktree detection must handle non-git directories gracefully (return null)

**Verify:**
- `require('./src/config').PORT` equals 3847
- `require('./src/config').AGENTS.codex.model` equals "gpt-5.3-codex"
- `require('./src/worktree').detectWorktree` is a function

---

### Task 4: Server (Backend Wiring)
**Agent:** Codex WSL
**Files:** create `F:/agent-dashboard/server.js`
**Depends on:** T1, T2, T3
**Wave:** 2

**Build:**
1. Create `server.js` — main entry point
2. Import express, ws, and all src/ modules
3. Set up Express to serve `public/` as static files
4. Create WebSocket server attached to the HTTP server
5. Implement poll loop (setInterval at POLL_INTERVAL):
   - Call `tmux.listSessions()`
   - For each session: `tmux.capturePane()`, `detect.parseSessionInfo()`, `worktree.detectWorktree()`
   - Diff against previous state — only push if changed
   - Broadcast `{ type: "state", sessions: [...] }` to all connected WS clients
6. Handle WS messages from clients:
   - `launch` → validate params, call `tmux.createSession()` with proper launch command from config, broadcast event
   - `kill` → call `tmux.killSession()`, broadcast event
   - `send` → call `tmux.sendKeys()`, broadcast event
   - `subscribe` → track per-client output subscriptions, start capturing for that session
7. For subscribed sessions in "tail" mode: capture pane on each poll, send `{ type: "output", ... }` to subscribed clients
8. Graceful shutdown: close WS, stop polling

**Constraints:**
- Never poll faster than 3s
- Broadcast to all clients on state change
- Log to console with `// SYSTEM:` prefix style

**Verify:**
- `node server.js` starts without error, serves on port 3847
- `curl http://localhost:3847/` returns HTML
- WebSocket connects at `ws://localhost:3847`

---

### Task 5: Frontend — HTML + CSS (VectorHeart Theme)
**Agent:** Opus WSL (complex styling task)
**Files:** create `F:/agent-dashboard/public/index.html`, create `F:/agent-dashboard/public/style.css`
**Depends on:** T0
**Wave:** 2

**Build:**
1. Create `public/index.html` — single page, no framework:
   - Top status bar: `REF: AGENT_DASHBOARD // SYSTEM_ACTIVE // <count> SESSIONS`
   - Main grid area: `#agent-grid` — responsive CSS grid for agent cards
   - Launch panel: collapsible section at top with preset buttons + advanced form
   - Each agent card template (cloned via JS):
     - Header: session name (bold) + agent type badge (cyan bg) + role badge
     - Status indicator: colored dot + text (cyan=ready, orange=running, dim=idle)
     - Info rows: workdir, worktree/branch, uptime
     - SSH command: monospace text + copy button
     - Output area: toggleable (off/tail/full), dark inner panel
     - Action bar: Send input + button, Kill button (orange/red)
   - Footer: `// AGENT_DASHBOARD V1.0 // PORT 3847`

2. Create `public/style.css` — full VectorHeart implementation:
   - CSS custom properties for all design tokens (colors, fonts, spacing)
   - `*` reset, box-sizing border-box
   - Body: `BG_PRIMARY` background, `FONT_MONO` font family, `WHITE` text
   - Status bar: `BG_DEEP` background, `CYAN` accent text, uppercase labels with `//` separators
   - Cards: `BG_SURFACE` background, `BORDER` 1px border, subtle hover glow (cyan)
   - Badges: small pills with `CYAN` bg for agent type, semi-transparent for role
   - Buttons: `CYAN` bg for primary actions, `ORANGE` bg for kill/danger
   - Input fields: `BG_DEEP` background, `BORDER` border, `CYAN` focus ring
   - Output area: `BG_DEEP` inner panel, `TEXT_MONO` colored text, subtle top border
   - Grid: CSS Grid, `repeat(auto-fill, minmax(480px, 1fr))`, gap 16px
   - Launch panel: preset buttons in flex row, advanced form in grid
   - Scrollbar styling: thin, `CYAN` thumb, `BG_DEEP` track
   - Status dots: 8px circles, CSS animation pulse for "running"
   - Responsive: stack to single column below 768px
   - Technical decoration: subtle corner brackets on cards (CSS pseudo-elements), `//` prefix on labels

**Constraints:**
- No CSS framework — hand-written to match VectorHeart exactly
- All colors via CSS custom properties (easy to tweak)
- No Google Fonts dependency — use system monospace fallback chain
- Animations: subtle only (pulse on running status, hover glow on cards)
- Mobile-friendly grid for phone access via Tailscale

**Verify:**
- Opening `index.html` directly shows the dark theme with correct colors
- Cards are visible with placeholder content
- Grid responds to viewport resize

---

### Task 6: Frontend — JavaScript Logic
**Agent:** Codex WSL
**Files:** create `F:/agent-dashboard/public/app.js`
**Depends on:** T4, T5
**Wave:** 3

**Build:**
1. Create `public/app.js` — all frontend logic in one file:

2. **WebSocket Client:**
   - Connect to `ws://localhost:3847`
   - Auto-reconnect on close (exponential backoff: 1s, 2s, 4s, max 30s)
   - Update connection status indicator in status bar

3. **State Management:**
   - `let sessions = []` — current session list
   - On `state` message: diff against current, update DOM incrementally (don't re-render everything)
   - Track per-card output subscription mode

4. **Card Rendering:**
   - `renderCard(session)` — creates/updates a card element in #agent-grid
   - `removeCard(sessionName)` — removes card when session disappears
   - Card shows all fields from protocol: name, agent badge, role badge, status dot, workdir, worktree, uptime (formatted mm:ss), SSH command
   - Copy button on SSH command (clipboard API)

5. **Output Panel:**
   - Three-way toggle per card: OFF / TAIL / FULL
   - TAIL mode: shows last 30 lines in a pre/code block, auto-scrolls
   - FULL mode: placeholder for xterm.js (Phase 2), falls back to tail for now
   - Sends `subscribe` message on toggle

6. **Launch Panel:**
   - Render preset buttons from config (hardcoded to match server presets)
   - Each button sends `launch` message with preset defaults
   - Advanced toggle shows form: agent select, role select, workdir input, session name input, flags input
   - "LAUNCH" button sends custom `launch` message

7. **Interaction:**
   - Kill button per card: shows confirmation overlay, sends `kill` on confirm
   - Send input per card: text field + send button, sends `send` message
   - Enter key in send input triggers send

8. **Status Bar:**
   - Session count, connection status (CONNECTED/RECONNECTING in cyan/orange)
   - Update on every state change

**Constraints:**
- Vanilla JS only — no framework, no build step
- DOM manipulation via `document.createElement`, not innerHTML (XSS prevention)
- All user input sanitized before sending
- Card elements cached by session name for efficient updates

**Verify:**
- `node server.js` then open `http://localhost:3847` — page loads, WS connects
- If tmux sessions exist, cards appear with correct data
- Launch preset creates a new session, card appears
- Kill button removes session after confirmation

---

### Task 7: Polish, Error Handling, xterm.js
**Agent:** Codex WSL
**Files:** modify `F:/agent-dashboard/public/app.js`, modify `F:/agent-dashboard/public/style.css`, modify `F:/agent-dashboard/server.js`
**Depends on:** T6
**Wave:** 4

**Build:**
1. Add xterm.js via CDN link in index.html: `<script src="https://cdn.jsdelivr.net/npm/xterm@5/lib/xterm.min.js">` + CSS
2. In app.js: when FULL mode selected, create xterm.Terminal instance in the output panel
3. Server: for FULL mode subscriptions, stream raw pane content including ANSI codes
4. Add error toasts: bottom-right notification area for errors (WSL timeout, session create fail, etc.)
5. Add "no sessions" empty state: large centered text `// NO_ACTIVE_SESSIONS // LAUNCH_TO_BEGIN`
6. Add session age formatting: "2m 34s", "1h 12m", etc.
7. Add loading skeleton for cards while first poll hasn't returned
8. Keyboard shortcuts: Escape closes modals, Ctrl+K focuses launch panel

**Constraints:**
- xterm.js loaded from CDN — no npm dependency for frontend
- Graceful fallback if CDN fails (show tail mode instead)
- Error toasts auto-dismiss after 5s

**Verify:**
- Full terminal mode shows colored output in xterm.js widget
- Error toast appears on simulated failure
- Empty state shown when no tmux sessions exist

---

## Status
**Phase:** Plan
**Wave:** —
**Completed:** —
**In Progress:** —
**Blocked:** —
**Decisions:** VectorHeart theme, WebSocket protocol defined, vanilla JS (no framework)
**Last updated:** 2026-02-23
