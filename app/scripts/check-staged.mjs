// Repo-wide hygiene checks on staged files (pre-commit). Applies to every folder, not just app/.
//
// Blocks a commit that stages:
//   - an environment or key file (.env, *.pem, id_rsa, ...): secrets belong in untracked files
//   - a file over 5 MB: use a release asset or a download link instead
//   - unresolved merge-conflict markers
//
// Bypass in an emergency with `git commit --no-verify` (and say why in the PR).

import { execFileSync } from 'node:child_process';

const MAX_BYTES = 5 * 1024 * 1024;
const SECRET_FILE = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.p12|.*\.pfx|.*\.key|id_rsa|id_ed25519)$/i;
const ALLOWED_ENV = /(^|\/)\.env\.example$/i;
const CONFLICT = /^(<{7}|>{7})( |$)/m;
const TEXT = /\.(c|h|cc|cpp|hpp|py|js|mjs|cjs|ts|tsx|jsx|html|css|json|toml|ya?ml|md|sql|sh|cmake|txt|pio)$/i;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);

const problems = [];
for (const file of staged) {
  if (SECRET_FILE.test(file) && !ALLOWED_ENV.test(file)) {
    problems.push(`${file}: looks like an environment or key file; keep it untracked`);
    continue;
  }
  const size = Number(git('cat-file', '-s', `:${file}`).trim());
  if (size > MAX_BYTES) problems.push(`${file}: ${(size / 1048576).toFixed(1)} MB, over the 5 MB limit`);
  if (TEXT.test(file) && size <= MAX_BYTES && CONFLICT.test(git('show', `:${file}`))) {
    problems.push(`${file}: contains merge-conflict markers`);
  }
}

if (problems.length) {
  console.error(`\n✖ Commit blocked:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(1);
}
