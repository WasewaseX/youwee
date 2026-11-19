// Calibrates scripts/gates/baselines.json (ratchet floors for legacy debt).
// bun scripts/gates/calibrate-baselines.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/scan-util.mjs';

const scanners = [
  'ai-slop.mjs',
  'humanized-code.mjs',
  'bug-patterns.mjs',
  'file-size.mjs',
  'i18n-parity.mjs',
  'xss-patterns.mjs',
  'line-length.mjs',
  'file-naming.mjs',
  'ts-any-audit.mjs',
];

const outPath = path.join(REPO_ROOT, 'scripts', 'gates', 'baselines.json');
const merged = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};

for (const scanner of scanners) {
  const raw = execSync(`bun scripts/gates/${scanner}`, {
    cwd: REPO_ROOT,
    env: { ...process.env, GATES_EMIT_BASELINE: '1' },
    maxBuffer: 32 * 1024 * 1024,
  }).toString();
  const jsonLine = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop();
  if (!jsonLine) throw new Error(`${scanner}: no baseline JSON emitted`);
  const parsed = JSON.parse(jsonLine);
  for (const [gate, value] of Object.entries(parsed)) {
    merged[gate] = value;
  }
}

fs.writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
const total = Object.values(merged).reduce(
  (acc, v) => acc + Object.values(v.perFile ?? {}).reduce((a, b) => a + b, 0),
  0,
);
console.log(
  'baselines.json written - ' +
    Object.keys(merged).length +
    ' ratchet categories, ' +
    total +
    ' total legacy units',
);
