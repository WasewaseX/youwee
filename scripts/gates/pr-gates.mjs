// Gate: PR HYGIENE (blocking title + advisory body/size)
import fs from 'node:fs';
import { changedFiles, failBlocking, finishAdvisory, loadGateConfig } from './lib/scan-util.mjs';

const config = loadGateConfig();
const titlePattern = new RegExp(config.pr.titlePattern);
const maxChangedLines = config.pr.maxChangedLines;

const blocking = [];
const advisory = [];

let pr = null;
try {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    pr = event.pull_request ?? null;
  }
} catch {
  pr = null;
}

if (!pr) {
  console.warn('PR HYGIENE: not a pull_request event (skip)');
  process.exit(0);
}

const title = (pr.title ?? '').trim();
if (!titlePattern.test(title)) {
  blocking.push(
    'PR title "' +
      title +
      '" must match Conventional Commits, e.g. "fix(ui): show-in-folder on macOS"',
  );
}

const body = (pr.body ?? '').trim();
if (body.length < 80) {
  advisory.push(
    `PR body is thin (${body.length} chars) - describe motivation, approach, and testing`,
  );
} else if (!body.includes('##')) {
  advisory.push('PR body should use markdown sections (## Summary, ## Verification...)');
}

const files = changedFiles();
let insertions = 0;
try {
  const { execSync } = await import('node:child_process');
  const base = process.env.GITHUB_BASE_REF ?? 'main';
  insertions = Number(
    execSync(`git diff --numstat origin/${base}...HEAD || git diff --numstat HEAD~1 HEAD`, {
      shell: '/bin/bash',
      cwd: process.env.GITHUB_WORKSPACE ?? process.cwd(),
      maxBuffer: 16 * 1024 * 1024,
    })
      .toString()
      .split('\n')
      .filter(Boolean)
      .reduce((acc, line) => acc + (Number(line.split('\t')[0]) || 0), 0),
  );
} catch {
  insertions = 0;
}
if (insertions > maxChangedLines) {
  advisory.push(
    'PR adds ' +
      insertions +
      ' lines (budget ' +
      maxChangedLines +
      ') - consider splitting into stacked PRs',
  );
}

console.log(`PR HYGIENE: files=${files.length}, insertions=${insertions}`);
failBlocking('PR HYGIENE', blocking);
finishAdvisory('PR HYGIENE advisory', advisory);
