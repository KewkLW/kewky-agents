# Codex CLI Setup

## Install

```bash
npm install -g @openai/codex
```

## Authentication (OAuth — no API key)

```bash
codex
# First run opens browser for OAuth login with your ChatGPT Plus subscription
```

Credentials are stored in `CODEX_HOME` directory (default: `~/.codex/`).

## Multi-Account Setup

To use separate rate limits (e.g., two ChatGPT Plus subscriptions):

```bash
# Account A (default)
export CODEX_HOME=~/.codex
codex  # OAuth login for account A

# Account B
export CODEX_HOME=~/.codex-account-b
codex  # OAuth login for account B
```

Each `CODEX_HOME` directory stores its own OAuth tokens. The dashboard sets this env var per session to route to different accounts.

## Launch Flags

| Flag | Purpose |
|------|---------|
| `--yolo` | Auto-approve all actions (unattended use) |
| `--model gpt-5.4-nano` | Select model variant |
| `--model gpt-5.4-mini` | Smaller/faster model |

## Dashboard Launch Commands

```bash
# Primary account (default model)
CODEX_HOME=~/.codex codex --yolo

# Alt account
CODEX_HOME=~/.codex-account-b codex --yolo

# Nano subagent
CODEX_HOME=~/.codex codex --yolo --model gpt-5.4-nano

# Mini subagent
CODEX_HOME=~/.codex codex --yolo --model gpt-5.4-mini
```

## Ready Detection

The CLI shows a `>` prompt or prints `codex` when ready for input.

## Remote Machine Setup

To run Codex agents on a remote machine via the dashboard's SSH spawning:

1. **Install Node.js and Codex CLI** on the remote machine
2. **Authenticate once** by running `codex` interactively and completing OAuth
3. **Enable SSH access** from the dashboard machine:
   - **macOS**: System Settings > General > Sharing > Remote Login
   - **Linux**: `sudo apt install openssh-server && sudo systemctl enable ssh`
   - **Windows**: Settings > Optional Features > OpenSSH Server > Install, then `Start-Service sshd`
4. **Set up SSH key auth**:
   ```bash
   ssh-copy-id user@remote-host
   ```
5. **Configure in dashboard `.env`**:
   ```bash
   REMOTE_HOST_MYBOX=user@remote-host:22:linux
   ```

For multi-account on a remote machine, SSH in and create both `~/.codex/` and `~/.codex-account-b/` with separate OAuth logins. The dashboard passes `CODEX_HOME` through the SSH session environment.

**Note on Windows remotes**: Windows OpenSSH does not forward environment variables by default. The `CODEX_HOME` env override won't work over SSH to Windows — use the default `~/.codex/` path on Windows remote hosts.
