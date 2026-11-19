// Gate: TYPE SAFETY DIFF (blocking on PRs)
import { execSync } from 'node:child_process';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const event = process.env.GITHUB_EVENT_NAME ?? '';
if (event !== 'pull_request') {
  console.log('TYPE SAFETY DIFF: not a PR (skip)');
  process.exit(0);
}

const base = process.env.GITHUB_BASE_REF ?? 'main';
execSync(`git fetch --no-tags origin ${base}`, { cwd: REPO_ROOT });

const diff = execSync(
  'git diff -U0 origin/' +
    base +
    "...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' 'sdk-js/**/*.ts' 'extensions/**/*.js'",
  { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 },
).toString();

const violations = [];
let file = '';
let line = 0;
for (const row of diff.split('\n')) {
  if (row.startsWith('+++ b/')) {
    file = row.slice(6);
    continue;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
  if (hunk) {
    line = Number(hunk[1]);
    continue;
  }
  if (!row.startsWith('+') || row.startsWith('+++')) continue;
  const content = row.slice(1);
  if (/\bas any\b/.test(content)) {
    violations.push(`${file}:${line}: added "as any" - type it properly`);
  }
  if (/@ts-ignore/.test(content) || /@ts-expect-error/.test(content)) {
    violations.push(`${file}:${line}: added @ts-ignore/@ts-expect-error - fix the type instead`);
  }
  line += 1;
}
failBlocking('TYPE SAFETY DIFF', violations);
