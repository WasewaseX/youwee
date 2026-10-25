// Regenerates .integrity/manifest.json (SHA-256 pins of CI-critical files).
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadGateConfig, REPO_ROOT } from './lib/scan-util.mjs';

const config = loadGateConfig();
const outPath = path.join(REPO_ROOT, '.integrity', 'manifest.json');

const tracked = execSync('git ls-files -z', { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 })
  .toString()
  .split('\0')
  .filter(Boolean);

function isProtected(rel) {
  return config.integrity.protectedGlobs.some((g) => {
    if (g.endsWith('/**')) return rel.startsWith(g.slice(0, -2));
    if (g.endsWith('/*')) {
      const dir = g.slice(0, -2);
      return rel.startsWith(`${dir}/`) && !rel.slice(dir.length + 1).includes('/');
    }
    return rel === g;
  });
}

const files = tracked.filter((rel) => rel !== '.integrity/manifest.json' && isProtected(rel));
const manifest = {
  $comment:
    'SHA-256 pins for CI-critical files. Regenerate: bun scripts/gates/integrity-generate.mjs',
  generatedAt: new Date().toISOString(),
  files: {},
};
for (const rel of files.sort()) {
  manifest.files[rel] = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(REPO_ROOT, rel)))
    .digest('hex');
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`pinned ${files.length} file(s) -> .integrity/manifest.json`);
