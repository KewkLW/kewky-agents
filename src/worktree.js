const { wslExec } = require('./tmux');

async function detectWorktree(workdir) {
  if (!workdir) return null;

  const raw = await wslExec(
    `cd '${workdir}' 2>/dev/null && git worktree list --porcelain 2>/dev/null`,
    5000
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

    const normalizedWorkdir = workdir.replace(/\/+$/, '');
    const normalizedWt = wtPath.replace(/\/+$/, '');

    if (normalizedWorkdir === normalizedWt || normalizedWorkdir.startsWith(normalizedWt + '/')) {
      if (wtPath.includes('.worktrees') || wtPath.includes('worktree')) {
        return { path: wtPath, branch };
      }
    }
  }

  return null;
}

module.exports = { detectWorktree };
