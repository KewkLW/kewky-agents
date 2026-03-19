# Multi-Account Pattern

## Concept

AI CLI tools store OAuth tokens in a config directory. By pointing different sessions at different config directories, you get:

- **Separate rate limits** — each account has its own quota
- **Parallel execution** — no throttling between accounts
- **Same machine** — no need for multiple users or VMs

## General Pattern

```
CONFIG_DIR_ENV=path/to/config-a  cli-tool  # uses account A tokens
CONFIG_DIR_ENV=path/to/config-b  cli-tool  # uses account B tokens
```

## Per-Tool Config Dirs

| Tool | Env Var | Default Location |
|------|---------|------------------|
| Codex | `CODEX_HOME` | `~/.codex/` |
| Claude | — (single account) | `~/.claude/` |
| Gemini | — (single account) | `~/.gemini/` |

Currently only Codex supports multi-account via config dir separation.

## Setup Steps

1. **Create a second config directory:**
   ```bash
   mkdir ~/.codex-account-b
   ```

2. **Authenticate the second account:**
   ```bash
   CODEX_HOME=~/.codex-account-b codex
   # Complete OAuth for your second subscription
   ```

3. **Use in dashboard config (`src/config.js`):**
   ```javascript
   'codex-primary': {
     launchCmd: 'codex --yolo',
     env: { CODEX_HOME: '~/.codex' }
   },
   'codex-alt': {
     launchCmd: 'codex --yolo',
     env: { CODEX_HOME: '~/.codex-account-b' }
   }
   ```

## Important Notes

- **No API keys** — all authentication is OAuth via subscription (ChatGPT Plus, Claude Pro, etc.)
- Each config dir needs its own initial OAuth login
- Tokens refresh automatically; no manual rotation needed
- If a token expires, the CLI will prompt for re-authentication
