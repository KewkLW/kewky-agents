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
