# Gemini CLI Setup

## Install

```bash
npm install -g @anthropic-ai/gemini-cli
# or
npm install -g @google/gemini-cli
```

## Authentication (OAuth — no API key)

```bash
gemini
# Follow the browser OAuth flow to sign in with your Google/Gemini subscription
```

## Launch Flags

| Flag | Purpose |
|------|---------|
| `--yolo` | Auto-approve all actions (unattended use) |

## Dashboard Launch Command

```bash
gemini --yolo
```

## Ctrl+Y Quirk

After launching, Gemini CLI requires a `Ctrl+Y` keypress to confirm yolo mode. The dashboard sends this automatically via `postLaunch: '\x19'` (the Ctrl+Y byte) after a 3-second delay.

## Ready Detection

The CLI shows `Type your message` or `shortcuts` when ready for input.

## Working Directory

Like other CLIs, Gemini operates in the directory it's launched from.

## Multiple Sessions

Each `gemini` process is independent. No special config needed for parallel sessions — rate limiting is handled server-side by Google.
