// Gate: AUTHOR INTEGRITY (blocking, strict)
// EVERY commit under review must be authored AND committed by WasewaseX.
import { execSync } from 'node:child_process';
import {
  commitsUnderReview,
  failBlocking,
  isMergeCommit,
  loadGateConfig,
  REPO_ROOT,
} from './lib/scan-util.mjs';

const config = loadGateConfig();
const { allowedLogin, allowedEmails } = config.author;
const allowedEmailSet = new Set(allowedEmails.map((e) => e.toLowerCase()));

const violations = [];
const shas = commitsUnderReview();

for (const sha of shas) {
  if (isMergeCommit(sha)) continue; // checkout merge refs are infrastructure
  let row;
  try {
    row = execSync(`git log -1 --format='%an|%ae|%cn|%ce' ${sha}`, { cwd: REPO_ROOT })
      .toString()
      .trim();
  } catch {
    violations.push(`${sha}: unable to read commit metadata`);
    continue;
  }
  const [authorName, authorEmail, committerName, committerEmail] = row.split('|');
  if (!allowedEmailSet.has((authorEmail ?? '').toLowerCase())) {
    violations.push(
      `${sha.slice(0, 12)}: author ${authorName} <${authorEmail}> is not ${allowedLogin}`,
    );
  }
  if (!allowedEmailSet.has((committerEmail ?? '').toLowerCase())) {
    violations.push(
      sha.slice(0, 12) +
        ': committer ' +
        committerName +
        ' <' +
        committerEmail +
        '> is not ' +
        allowedLogin,
    );
  }
}

if (shas.length === 0) {
  console.warn('AUTHOR GATE: no commits under review (skip)');
  process.exit(0);
}
console.log(`AUTHOR GATE: checked ${shas.length} commit(s) - required identity: ${allowedLogin}`);
failBlocking('AUTHOR GATE (WasewaseX only)', violations);
