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

## Non-Interactive Mode

For scripted use (outside the dashboard):

```bash
node run_codex_review.js "your prompt here"
```

This uses Node.js `child_process.spawn` with `shell: true` and reads stdin with `-`.
