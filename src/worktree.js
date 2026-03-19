const { exec } = require('child_process');

function nativeExec(cmd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(null);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function detectWorktree(workdir) {
  if (!workdir) return null;

  const raw = await nativeExec(
    `git -C "${workdir}" worktree list --porcelain`
  );
  if (!raw) return null;

  const blocks = raw.trim().split('\n\n').filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    let wtPath = '';
    let branch = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice(9);
      } else if (line.startsWith('branch ')) {
        branch = line.slice(7).replace('refs/heads/', '');
      }
    }

    const normalizedWorkdir = workdir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
    const normalizedWt = wtPath.replace(/[\\/]+$/, '').replace(/\\/g, '/');

    if (normalizedWorkdir === normalizedWt || normalizedWorkdir.startsWith(normalizedWt + '/')) {
      if (wtPath.includes('.worktrees') || wtPath.includes('worktree')) {
        return { path: wtPath, branch };
      }
    }
  }

  return null;
}

module.exports = { detectWorktree };
