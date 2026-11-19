// Gate: CODE INTEGRITY MANIFEST (blocking)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, loadGateConfig, REPO_ROOT } from './lib/scan-util.mjs';

const config = loadGateConfig();
const manifestPath = path.join(REPO_ROOT, '.integrity', 'manifest.json');
const violations = [];

if (!fs.existsSync(manifestPath)) {
  violations.push('.integrity/manifest.json missing');
  failBlocking('CODE INTEGRITY MANIFEST', violations);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const globs = config.integrity.protectedGlobs;
const { execSync } = await import('node:child_process');
const tracked = execSync('git ls-files -z', { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 })
  .toString()
  .split('\0')
  .filter(Boolean);
const files = tracked.filter((rel) => {
  if (rel === '.integrity/manifest.json') return false;
  return globs.some((g) => {
    if (g.endsWith('/**')) return rel.startsWith(g.slice(0, -2));
    if (g.endsWith('/*')) {
      const dir = g.slice(0, -2);
      return rel.startsWith(`${dir}/`) && !rel.slice(dir.length + 1).includes('/');
    }
    return rel === g;
  });
});

const manifestEntries = new Set(Object.keys(manifest.files ?? {}));
for (const rel of files) {
  const expected = manifest.files?.[rel];
  if (expected === undefined) {
    violations.push(`${rel}: protected file is NOT pinned in .integrity/manifest.json`);
    continue;
  }
  const actual = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(REPO_ROOT, rel)))
    .digest('hex');
  if (actual !== expected) {
    violations.push(
      rel +
        ': integrity mismatch (SHA-256 changed) - refresh with bun scripts/gates/integrity-generate.mjs',
    );
  }
  manifestEntries.delete(rel);
}
for (const stale of manifestEntries) {
  violations.push(`${stale}: pinned in manifest but no longer tracked`);
}

console.log(`CODE INTEGRITY: verified ${files.length} protected file(s)`);
failBlocking('CODE INTEGRITY MANIFEST', violations);
