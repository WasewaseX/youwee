// Gate: CLIPPY DIFF (blocking)
// Parses `cargo clippy --message-format=json` output and:
//   - BLOCKS on any clippy warning/error in files changed by the PR
//     (zero new clippy debt allowed — new code must be clippy-clean)
//   - REPORTS legacy warnings in untouched upstream files as counts
//     (non-blocking; the counts only fall as upstream cleans up)
// Expects the clippy JSON as a file: target/clippy-output.json

import fs from 'node:fs';
import path from 'node:path';
import { changedFiles, failBlocking, finishAdvisory, REPO_ROOT } from './lib/scan-util.mjs';

const jsonPath = path.join(REPO_ROOT, 'target', 'clippy-output.json');
if (!fs.existsSync(jsonPath)) {
  console.warn('CLIPPY DIFF: no clippy output found (skip)');
  process.exit(0);
}

const raw = fs.readFileSync(jsonPath, 'utf8');
const warnings = [];

for (const line of raw.split('\n')) {
  if (!line.trim().startsWith('{')) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.reason !== 'compiler-message') continue;
  const msg = entry.message;
  if (!msg || (msg.level !== 'warning' && msg.level !== 'error')) continue;
  const primary = (msg.spans ?? []).find((s) => s.is_primary);
  if (!primary?.file_name) continue;
  const code = msg.code?.code ?? 'unknown';
  warnings.push({
    file: primary.file_name.replace(/\\/g, '/'),
    line: primary.line_start,
    level: msg.level,
    code,
    message: msg.message,
  });
}

const changed = new Set(changedFiles().map((f) => f.replace(/^src-tauri\//, '')));
const changedRoot = new Set(changedFiles());

const blocking = [];
const legacyPerFile = {};

for (const w of warnings) {
  const hit = `src-tauri/${w.file}:${w.line}: [${w.code}] ${w.message}`;
  if (changed.has(w.file) || changedRoot.has(`src-tauri/${w.file}`)) {
    blocking.push(hit);
  } else {
    legacyPerFile[w.file] = (legacyPerFile[w.file] ?? 0) + 1;
  }
}

const legacyTotal = Object.values(legacyPerFile).reduce((a, b) => a + b, 0);
console.log(
  `CLIPPY DIFF: ${warnings.length} total, ${blocking.length} in changed files, ${legacyTotal} legacy`,
);

fs.writeFileSync(
  path.join(REPO_ROOT, 'target', 'clippy-legacy-summary.json'),
  `${JSON.stringify({ perFile: legacyPerFile }, null, 2)}\n`,
);

failBlocking('CLIPPY DIFF (new code)', blocking);
finishAdvisory('CLIPPY DIFF legacy (non-blocking)', []);
