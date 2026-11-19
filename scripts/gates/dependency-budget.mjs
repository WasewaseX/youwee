// Gate: DEPENDENCY BUDGET & SINGLE LOCKFILE (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];

// Cross lockfiles are banned: Bun is the single source of truth.
for (const lf of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'shrinkwrap.yaml']) {
  if (fs.existsSync(path.join(REPO_ROOT, lf))) {
    violations.push(`${lf}: foreign lockfile committed - use bun.lock only`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});
const devDeps = Object.keys(pkg.devDependencies ?? {});
if (deps.length > 90) {
  violations.push(`package.json: ${deps.length} runtime dependencies exceeds budget of 90`);
}
if (devDeps.length > 120) {
  violations.push(`package.json: ${devDeps.length} dev dependencies exceeds budget of 120`);
}
console.log(`DEPENDENCY BUDGET: ${deps.length} deps, ${devDeps.length} devDeps`);
failBlocking('DEPENDENCY BUDGET & LOCKFILE', violations);
