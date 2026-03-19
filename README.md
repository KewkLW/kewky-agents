# Agent Dashboard

Real-time web UI for managing AI agent sessions (Claude, Codex, Gemini). Launches agents as interactive terminal sessions via `node-pty`, with live status detection, output tailing, and full browser-based terminal access.

Sessions are managed in-process and **do not survive server restart**.

## Prerequisites

- **Node.js** 18+ (with native addon support for `node-pty`)
- **Git** on PATH (for worktree detection)
- At least one AI CLI tool installed: `claude`, `codex`, `gemini`

### Platform-specific

| Platform | Shell used by sessions | Notes |
|----------|----------------------|-------|
| **Windows** | `cmd.exe /c <command>` | Requires Windows build tools for `node-pty`: `npm install -g windows-build-tools` or install Visual Studio C++ workload |
| **Linux** | `$SHELL -c <command>` (defaults to `/bin/sh`) | Requires `build-essential` and `python3` for `node-pty` native compilation |
| **macOS** | `$SHELL -c <command>` (defaults to `/bin/sh`) | Requires Xcode Command Line Tools: `xcode-select --install` |

## Install

```bash
git clone <repo-url> agent-dashboard
cd agent-dashboard
npm install
```

If `npm install` fails on `node-pty`, ensure you have the native build toolchain for your OS (see table above).

## Run

```bash
npm start
# or
node server.js
```

Open `http://localhost:3847` in your browser.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_DASH_PORT` | `3847` | Server port |
| `TAILSCALE_HOST` | `localhost` | Hostname for remote terminal URLs (set to your Tailscale IP for mobile access) |
| `WSL_DISTRO` | `Ubuntu-24.04` | WSL distribution for WSL agent spawning (Windows only) |
| `REMOTE_HOST_*` | *(none)* | SSH remote hosts (see below) |
| `ACTIVE_TEAM` | *(empty)* | Team name for claude-teams MCP integration |
| `TEAMS_MCP_PATH` | *(empty)* | Path to claude-teams MCP server |
| `CODEX_HOME` | `~/.codex` | Codex config directory (primary account) |
| `CODEX_HOME_ALT` | `~/.codex-account-b` | Codex config directory (secondary account) |
| `RESEARCH_DIR` | `./research-output` | Directory for research mission output |

You can also create a `.env` file in the project root.

## Cross-Platform Agent Spawning

The dashboard can spawn agents on the local machine, inside WSL (Windows only), or on remote machines over SSH.

### Local (native)

Agents spawn directly using the local shell. This is the default and requires no extra configuration — just install the CLI tools and authenticate.

### WSL (Windows only)

On Windows with WSL installed, agents can be spawned inside a WSL distribution. WSL presets appear automatically in the UI when WSL is detected. Set `WSL_DISTRO` to choose which distro (default: `Ubuntu-24.04`).

The CLI tools must be installed and authenticated **inside the WSL distro**, not just on the Windows side.

### SSH Remote Hosts

Spawn agents on remote machines (another PC, Mac, server, Raspberry Pi) over SSH.

**Format**: `REMOTE_HOST_<NAME>=user@host:port:os`

| Field | Required | Default | Values |
|-------|----------|---------|--------|
| `user@host` | yes | — | SSH user and hostname/IP |
| `port` | no | `22` | SSH port |
| `os` | no | `linux` | `windows`, `macos`, or `linux` |

The `os` field controls how commands are wrapped on the remote:
- **`linux`** — `bash -l -c 'command'` (loads profile for nvm, pyenv, etc.)
- **`macos`** — `bash -l -c` with Homebrew `shellenv` for PATH resolution
- **`windows`** — command sent directly (Windows OpenSSH uses cmd.exe)

**Example `.env`**:
```bash
REMOTE_HOST_PC=kewkd@192.168.1.10:22:windows
REMOTE_HOST_MAC=user@macbook.local:22:macos
REMOTE_HOST_PI=pi@raspberrypi.local:22:linux
```

**Remote machine requirements**:
1. SSH server enabled with key-based auth (`ssh-copy-id user@host`)
2. Node.js installed (for the CLI tools)
3. At least one CLI tool installed and OAuth'd (see `docs/setup-*.md`)

See individual agent setup guides for detailed remote instructions:
- [docs/setup-claude.md](docs/setup-claude.md)
- [docs/setup-codex.md](docs/setup-codex.md)
- [docs/setup-gemini.md](docs/setup-gemini.md)
- [docs/setup-multi-account.md](docs/setup-multi-account.md)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Dashboard configuration, presets, platform info |
| `/api/agents` | GET | List active agents with status, type, platform, host |
| `/api/send` | POST | Send message to agent stdin: `{ from, to, message }` |
| `/api/messages` | GET | Audit log of inter-agent messages (last 500) |
| `/api/team/status` | GET | All agent session statuses |
| `/api/team/launch` | POST | Launch agent: `{ agent, role, platform, host }` |
| `/api/team/send` | POST | Send to session: `{ session, message }` |
| `/api/team/output/:session` | GET | Read agent output lines |
| `/api/team/kill` | POST | Kill session: `{ session }` |

## Usage

### Launch agents

Click a preset button (OPUS_BUILDER, CODEX_PRIMARY, etc.) or use the Advanced form to pick an agent, role, working directory, and flags.

### Session cards

Each running session shows:
- **Status** (working, idle, thinking, error, etc.) auto-detected from terminal output
- **Uptime** since launch
- **Working directory** and git worktree branch (if applicable)
- **Terminal URL** for remote access

### Output modes

- **OFF** -- no output shown (default)
- **TAIL** -- last 30 lines of plain text output, auto-scrolling
- **FULL** -- embedded xterm.js terminal with interactive input

### ATTACH (browser terminal)

Click **ATTACH** on any card to open a full browser terminal (`terminal.html`) with real-time bidirectional I/O. Works on desktop and mobile. Multiple clients can watch the same session.

### Research missions

Switch to the **RESEARCH** tab to deploy multiple agents on a research topic. Each agent writes findings to a shared output directory. Reports are viewable in-browser once complete.

### Team coordination

Use the **TEAM BRIEF** feature to auto-launch a team lead agent that coordinates other agents via the dashboard API.

## Architecture

```
server.js              Express + WebSocket server
src/sessions.js        node-pty session lifecycle (create/kill/write/resize)
src/config.js          Agent definitions, presets, env config
src/platform.js        Platform detection (local OS, WSL, SSH remote hosts)
src/detect.js          Status detection from terminal output
src/research.js        Multi-agent research missions
src/auto-nudge.js      Auto-nudge idle agents
src/auto-distribute.js Task auto-distribution
src/worktree.js        Git worktree detection
src/comms.js           Team communication polling
public/                Static frontend (app.js, terminal.html, styles)
docs/                  Agent CLI setup guides
```
