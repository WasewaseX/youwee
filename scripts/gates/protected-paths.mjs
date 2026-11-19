// Gate: PROTECTED PATHS / CI TAMPER CHECK (blocking)
// Changes to CI-critical files require the integrity manifest update in the
// same change, or the "ci-change" PR label (reviewed CI work).
import fs from 'node:fs';
import { changedFiles, failBlocking, loadGateConfig } from './lib/scan-util.mjs';

const config = loadGateConfig();
const globs = config.integrity.protectedGlobs;

function touchesProtected(file) {
  return globs.some((g) => {
    if (g.endsWith('/**')) return file.startsWith(g.slice(0, -2));
    if (g.endsWith('/*')) {
      const dir = g.slice(0, -2);
      return file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/');
    }
    return file === g;
  });
}

const changed = changedFiles();
const protectedChanged = changed.filter(touchesProtected);

if (protectedChanged.length === 0) {
  console.log('PROTECTED PATHS: no CI-critical files changed');
  process.exit(0);
}

let labels = '';
try {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    labels = (event.pull_request?.labels ?? []).map((l) => l.name).join(',');
  }
} catch {
  labels = process.env.PR_LABELS ?? '';
}

if (labels.split(',').includes('ci-change')) {
  console.log('PROTECTED PATHS: PR carries "ci-change" label - allowed with review');
  process.exit(0);
}

const manifestTouched = changed.includes('.integrity/manifest.json');
if (!manifestTouched) {
  failBlocking('PROTECTED PATHS', [
    `CI-critical files changed without integrity manifest update: ${protectedChanged.join(', ')}`,
    'Regenerate the pin (bun scripts/gates/integrity-generate.mjs) and commit it in the same PR, or label the PR "ci-change".',
  ]);
}
console.log(
  `PROTECTED PATHS: ${protectedChanged.length} protected file(s) changed with manifest update`,
);
