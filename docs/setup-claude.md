# Claude CLI Setup

## Install

```bash
npm install -g @anthropic-ai/claude-code
```

## Authentication (OAuth — no API key)

```bash
claude
# Follow the browser OAuth flow to sign in with your Claude Pro/Max subscription
```

This stores credentials in `~/.claude/` automatically.

## Launch Flags

| Flag | Purpose |
|------|---------|
| `--model claude-opus-4-6[1m]` | Select model (opus/sonnet/haiku) |
| `--dangerously-skip-permissions` | Auto-approve all tool calls (unattended use) |
| `--resume` | Resume the most recent conversation |
| `--continue` | Continue the most recent conversation in a new session |

## Dashboard Launch Commands

The dashboard uses these commands:

```bash
# Opus (1M context)
claude --dangerously-skip-permissions --model "claude-opus-4-6[1m]"

# Sonnet
claude --dangerously-skip-permissions --model claude-sonnet-4-5-20250929

# Haiku
claude --dangerously-skip-permissions --model claude-haiku-4-5-20251001
```

## Permissions

With `--dangerously-skip-permissions`, Claude auto-approves file edits, bash commands, and MCP tool calls. Without it, the CLI prompts for each action.

## Working Directory

Claude operates in the directory it's launched from. The dashboard passes `cwd` to control this per session.

## Ready Detection

The CLI shows a prompt containing `Try` or `context left` when ready for input.

## Multiple Sessions

Each `claude` process is independent. No config-dir separation needed — OAuth tokens are shared, and Anthropic handles rate limiting per subscription.

## Remote Machine Setup

To run Claude agents on a remote machine via the dashboard's SSH spawning:

1. **Install Node.js and Claude CLI** on the remote machine
2. **Authenticate once** by running `claude` interactively and completing OAuth
3. **Enable SSH access** from the dashboard machine:
   - **macOS**: System Settings > General > Sharing > Remote Login
   - **Linux**: `sudo apt install openssh-server && sudo systemctl enable ssh`
   - **Windows**: Settings > Optional Features > OpenSSH Server > Install, then `Start-Service sshd`
4. **Set up SSH key auth** (so the dashboard doesn't hang on password prompts):
   ```bash
   # From the dashboard machine:
   ssh-copy-id user@remote-host
   ```
5. **Configure in dashboard `.env`**:
   ```bash
   REMOTE_HOST_MYBOX=user@remote-host:22:macos   # or :linux or :windows
   ```

Claude credentials are stored per-user (`~/.claude/`), so each remote user account needs its own OAuth login.
