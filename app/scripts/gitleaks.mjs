// Runs gitleaks over the whole repository with app/.gitleaks.toml.
//
//   node scripts/gitleaks.mjs staged          pre-commit: only what's staged
//   node scripts/gitleaks.mjs push <range>    pre-push: commits about to be pushed
//   node scripts/gitleaks.mjs scan            full history (npm run secrets)
//
// gitleaks is a standalone binary, not an npm package. Install it once:
//   Windows: winget install -e --id Gitleaks.Gitleaks
//   macOS:   brew install gitleaks
//   Linux:   https://github.com/gitleaks/gitleaks/releases

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = join(repoRoot, 'app', '.gitleaks.toml');

// winget updates PATH only for new shells, so also look where it installs.
function findGitleaks() {
  const exe = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  const probe = spawnSync(exe, ['version'], { encoding: 'utf8' });
  if (probe.status === 0) return exe;
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const candidates = [join(local, 'Microsoft', 'WinGet', 'Links', exe)];
  const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(pkgs)) {
    for (const d of readdirSync(pkgs))
      if (d.startsWith('Gitleaks.Gitleaks')) candidates.push(join(pkgs, d, exe));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

const [mode = 'scan', range] = process.argv.slice(2);
const bin = findGitleaks();
if (!bin) {
  console.error(
    '\n✖ gitleaks is not installed, so secrets could not be checked.\n' +
      '  Windows: winget install -e --id Gitleaks.Gitleaks\n' +
      '  macOS:   brew install gitleaks\n' +
      '  Then open a new terminal and try again.\n',
  );
  process.exit(1);
}

const common = ['--config', config, '--redact', '--no-banner', '--no-color', '--exit-code', '1'];
const args = {
  staged: ['git', '--pre-commit', '--staged', ...common, '.'],
  push: ['git', '--log-opts', range ?? 'HEAD', ...common, '.'],
  scan: ['git', '--log-opts', '--all', ...common, '.'],
}[mode];
if (!args) {
  console.error(`Unknown mode "${mode}". Use staged, push or scan.`);
  process.exit(2);
}

const r = spawnSync(bin, args, { cwd: repoRoot, stdio: 'inherit' });
if (r.status !== 0) {
  console.error(
    '\n✖ gitleaks found something that looks like a secret (output above, values redacted).\n' +
      '  Remove it, keep it in an untracked .env file instead, and rotate it if it was real.\n' +
      '  False positive? Add a `gitleaks:allow` comment on that line.\n',
  );
}
process.exit(r.status ?? 1);
