// Gate: CIRCULAR IMPORT RATCHET (blocking; total count may fall, never rise)
// Runs madge over src/ and compares the circular-dependency count against
// baselines.json -> circularImports.total. Upstream currently carries 5
// cycles; new cycles block the PR until the baseline is lowered.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, loadBaselines, REPO_ROOT } from './lib/scan-util.mjs';

const BASELINE_KEY = 'circularImports';
const MADGE_ARGS = ['madge', '--circular', '--extensions', 'ts,tsx', '--json', 'src'];

// madge exits non-zero when it finds cycles; stdout still carries the JSON.
let stdout = '';
try {
  stdout = execFileSync('bunx', MADGE_ARGS, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (err) {
  if (typeof err.stdout === 'string' && /^\s*[[{]/.test(err.stdout)) {
    stdout = err.stdout;
  } else {
    const detail = err.stderr ? String(err.stderr).slice(0, 2000) : err.message;
    console.error(`madge failed to run: ${detail}`);
    process.exit(1);
  }
}

let parsed;
try {
  parsed = JSON.parse(stdout);
} catch {
  console.error('madge did not return JSON on stdout');
  process.exit(1);
}

// madge --circular --json prints the cycle list as a top-level array (older
// releases wrap it in an object under .circular); accept both shapes.
const cycles = Array.isArray(parsed)
  ? parsed
  : Array.isArray(parsed?.circular)
    ? parsed.circular
    : [];
const current = cycles.length;
const baselines = loadBaselines();
const baseline = Number(baselines[BASELINE_KEY]?.total ?? 0);

if (process.env.GATES_EMIT_BASELINE === '1') {
  const baselinePath = path.join(REPO_ROOT, 'scripts', 'gates', 'baselines.json');
  baselines[BASELINE_KEY] = { total: current };
  fs.writeFileSync(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
  console.log(`baseline written: ${BASELINE_KEY}.total = ${current}`);
  process.exit(0);
}

const formatted = cycles.map((cycle) => cycle.join(' -> '));
console.log(`circular imports: ${current} (baseline allows ${baseline})`);
for (const cycle of formatted) console.log(`  ${cycle}`);

const violations = [];
if (current > baseline) {
  violations.push(
    `${current} circular dependencies exceed the ratchet floor of ${baseline} - ` +
      'break the new cycles, or lower circularImports.total in baselines.json ' +
      'in the same PR if you genuinely fixed older ones',
  );
}
failBlocking('CIRCULAR IMPORTS', violations);
