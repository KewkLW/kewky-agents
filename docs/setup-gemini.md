# Gemini CLI Setup

## Install

```bash
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

## Remote Machine Setup

To run Gemini agents on a remote machine via the dashboard's SSH spawning:

1. **Install Node.js and Gemini CLI** on the remote machine
2. **Authenticate once** by running `gemini` interactively and completing OAuth
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
   REMOTE_HOST_MYBOX=user@remote-host:22:macos
   ```

**Note on Ctrl+Y**: The `postLaunch` Ctrl+Y byte is sent to the local PTY, which forwards it over the SSH connection. This works transparently — no special remote configuration needed.
