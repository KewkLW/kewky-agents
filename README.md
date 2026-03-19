# Kewky Agents

A multi-agent dashboard for orchestrating AI coding agents (Claude, Codex, Gemini) across machines. Launch agents, monitor their status in real-time, and let them coordinate — all from a single web UI.

## Quick Start

```bash
git clone https://github.com/KewkLW/kewky-agents.git
cd kewky-agents
```

Then tell your AI assistant:

> Set up Kewky Agents. Read the README and docs/ folder, install dependencies, and configure it for my machine.

That's it. Your AI reads the setup guides, installs what's needed, and gets everything running.

---

## What This Does

Kewky Agents is a command center for running multiple AI coding agents simultaneously. Think of it as a process manager with a web UI, purpose-built for AI CLI tools.

You can:
- **Launch agents** with one click from preset configurations
- **Monitor status** — see which agents are working, idle, thinking, or stuck
- **Read output** — tail logs or open a full interactive terminal in your browser
- **Send commands** — type instructions directly into any agent's stdin
- **Coordinate teams** — agents can discover each other and exchange messages
- **Span machines** — run agents on your PC, Mac, Linux box, or Raspberry Pi over SSH

## How It Works

### The Dashboard Server

A Node.js server (`server.js`) manages everything:

- **`node-pty`** spawns each agent as a pseudo-terminal process — the same thing your terminal emulator uses. Agents think they're running in a normal terminal.
- **WebSocket connections** push live status updates to the browser UI every 3 seconds.
- **Status detection** (`src/detect.js`) reads the last few lines of each agent's terminal output and pattern-matches to determine state: `working`, `idle`, `thinking`, `waiting_approval`, `error`, etc. No agent modification needed — it watches what they print.
- **REST API** lets agents (or scripts, or other tools) query who's running and send messages programmatically.

### Agent Spawning

When you click a preset button or call the API:

1. The server looks up the agent config (launch command, model, environment variables)
2. It spawns a PTY process with the appropriate shell:
   - **Native**: `cmd.exe /c <command>` on Windows, `$SHELL -c <command>` on Mac/Linux
   - **WSL**: `wsl.exe -d Ubuntu-24.04 -- bash -l -c <command>` (Windows only)
   - **SSH**: `ssh -t user@host <wrapped-command>` with OS-aware wrapping:
     - Linux targets: `bash -l -c 'command'`
     - macOS targets: `bash -l -c` with Homebrew PATH setup
     - Windows targets: command passed directly to cmd.exe
3. Output is captured into a ring buffer (ANSI-stripped for status detection, raw for terminal replay)
4. The browser gets notified of the new session

### Inter-Agent Communication

Agents can discover and message each other through the dashboard API:

- `GET /api/agents` — returns all active agents with their status, type, platform, and host
- `POST /api/send` — delivers a message to an agent's terminal stdin, formatted as `[MSG from <sender>]: <message>`
- `GET /api/messages` — audit log of the last 500 inter-agent messages

The `AGENT_DASHBOARD_URL` environment variable is injected into every spawned session, so agents know where to reach the API.

### Team Coordination

The dashboard can auto-launch a **team lead** agent (an Opus instance with a coordination prompt) that:

1. Receives a mission briefing from you
2. Decomposes it into subtasks
3. Launches worker agents via the API
4. Monitors their progress through status polling
5. Sends corrective guidance when agents get stuck
6. Synthesizes outputs into a final deliverable

### Research Missions

The Research tab lets you deploy multiple agents on a research topic simultaneously. Each agent independently investigates and writes findings to a shared output directory. Results are viewable as a combined report in the browser.

## What Gets Sent Where

**Full transparency on data flow:**

- **Agent CLI tools** (claude, codex, gemini) connect to their respective cloud APIs (Anthropic, OpenAI, Google) using OAuth tokens from your subscription. The dashboard does not touch these connections.
- **The dashboard server** runs locally on your machine. It does not phone home, collect telemetry, or send data anywhere.
- **SSH spawning** opens standard SSH connections to your configured remote hosts. Commands and output travel over your SSH tunnel.
- **The browser UI** connects to the local dashboard server via WebSocket. No external CDNs or analytics — all static assets are bundled locally (xterm.js, marked.js).
- **No API keys are used or stored.** All AI access is through OAuth/subscription authentication managed by each CLI tool independently.

## Prerequisites

- **Node.js 18+** with native addon support (for `node-pty` compilation)
- **Git** on PATH
- **At least one AI CLI tool** installed and authenticated:
  - Claude CLI: `npm i -g @anthropic-ai/claude-code` → run `claude` to OAuth
  - Codex CLI: `npm i -g @openai/codex` → run `codex` to OAuth
  - Gemini CLI: `npm i -g @google/gemini-cli` → run `gemini` to OAuth

### Platform Build Tools (for node-pty)

| Platform | Requirement |
|----------|-------------|
| **Windows** | Visual Studio C++ Build Tools or `npm i -g windows-build-tools` |
| **macOS** | `xcode-select --install` |
| **Linux** | `sudo apt install build-essential python3` |

## Install & Run

```bash
git clone https://github.com/KewkLW/kewky-agents.git
cd kewky-agents
npm install
npm start
```

Open `http://localhost:3847`

## Configuration

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_DASH_PORT` | `3847` | Server port |
| `TAILSCALE_HOST` | `localhost` | Hostname for remote terminal URLs |
| `CODEX_HOME` | `~/.codex` | Codex config dir (primary account) |
| `CODEX_HOME_ALT` | `~/.codex-account-b` | Codex config dir (alt account) |

### Cross-Platform Spawning

#### WSL (Windows only)

Agents can spawn inside WSL. Presets appear automatically when WSL is detected.

```bash
WSL_DISTRO=Ubuntu-24.04   # Which distro to use
```

The CLI tools must be installed inside the WSL distro, not just on the Windows side.

#### SSH Remote Hosts

Spawn agents on other machines over SSH.

```bash
# Format: REMOTE_HOST_<NAME>=user@host:port:os
REMOTE_HOST_PC=kewkd@192.168.1.10:22:windows
REMOTE_HOST_MAC=user@macbook.local:22:macos
REMOTE_HOST_PI=pi@raspberrypi.local:22:linux
```

The `os` field (`windows`, `macos`, `linux`) tells the dashboard how to wrap commands on the remote end. Port defaults to `22`, OS defaults to `linux`.

**Remote machine requirements:**
1. SSH server enabled with key-based auth
2. Node.js + at least one CLI tool installed and OAuth'd

See `docs/setup-*.md` for per-agent remote setup instructions.

## Settings Tab

The browser UI includes a Settings tab where you can toggle features on/off:

| Toggle | What it controls |
|--------|-----------------|
| WSL Presets | Show/hide WSL agent launch buttons |
| Remote Hosts | Show/hide SSH remote agent presets |
| Research Tab | Show/hide the research mission deployment tab |
| Team Comms | Show/hide inter-agent message feed on cards |
| Advanced Launch | Show/hide the manual launch form with custom flags |

Settings persist in your browser's localStorage.

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Dashboard configuration and platform info |
| `/api/agents` | GET | Active agents with status, type, platform |
| `/api/team/status` | GET | All session statuses |
| `/api/team/launch` | POST | Launch agent: `{ agent, role, platform, host }` |
| `/api/team/send` | POST | Send to session: `{ session, message }` |
| `/api/team/output/:session` | GET | Read agent output |
| `/api/team/kill` | POST | Kill session: `{ session }` |

## Architecture

```
server.js              Express + WebSocket server
src/sessions.js        PTY session lifecycle (create/kill/write/resize)
src/config.js          Agent definitions, presets, env config
src/platform.js        Platform detection (local OS, WSL, SSH remotes)
src/detect.js          Status detection from terminal output
src/research.js        Multi-agent research missions
src/auto-nudge.js      Auto-nudge idle agents
src/auto-distribute.js Task auto-distribution
src/worktree.js        Git worktree detection
src/comms.js           Team communication polling
public/                Static frontend (app.js, terminal.html, styles)
docs/                  Agent CLI setup guides
```

## Docs

- [docs/setup-claude.md](docs/setup-claude.md) — Claude CLI install, auth, flags, remote setup
- [docs/setup-codex.md](docs/setup-codex.md) — Codex CLI install, auth, multi-account, remote setup
- [docs/setup-gemini.md](docs/setup-gemini.md) — Gemini CLI install, auth, Ctrl+Y quirk, remote setup
- [docs/setup-multi-account.md](docs/setup-multi-account.md) — Running multiple accounts for parallel rate limits

## License

MIT
