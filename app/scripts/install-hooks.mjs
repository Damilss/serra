// Turns on the repo-wide git hooks in app/.husky (runs on `npm install`, via "prepare").
//
// Husky sets git's core.hooksPath, which applies to the whole repository, so the hooks
// check every commit and push, not just app/. Husky has to run from the repository root.
// Skipped in CI and when HUSKY=0.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CI || process.env.HUSKY === '0') process.exit(0);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!existsSync(join(repoRoot, '.git'))) process.exit(0); // e.g. installed from a tarball

const { default: husky } = await import('husky');
process.chdir(repoRoot);
const msg = husky('app/.husky');
if (msg) console.log(`husky: ${msg}`);
