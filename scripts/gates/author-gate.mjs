// Gate: AUTHOR INTEGRITY (blocking, strict)
// EVERY commit under review must be authored AND committed by WasewaseX.
//
// F3 (review): email TEXT is attacker-controlled — any account can set both
// author and committer emails to an allowed address and pass an email-only
// check. Acceptance therefore requires an AUTHENTICATED identity as well:
// a commit is accepted when it is cryptographically SIGNED with a key that
// git can verify (`git verify-commit`) OR when the GitHub commits API
// resolves BOTH the author and the committer to the allowed login (only
// true when GitHub has linked the email to the verified account). Unsigned
// commits with an allowed email that GitHub cannot attribute to the
// allowed login are REJECTED. Merge permissions remain the second,
// independent layer of defense.
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

/** Owner/name of the repo under review (CI env first, remote URL fallback). */
function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execSync('git remote get-url origin', { cwd: REPO_ROOT }).toString().trim();
  const m = /[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * F3: authenticated identity for one commit — 'signed' when git verifies a
 * cryptographic signature, 'api' when the GitHub commits API links BOTH the
 * author and the committer to the allowed login, null when neither holds.
 */
function authenticatedIdentity(sha, slug, token) {
  try {
    execSync(`git verify-commit ${sha}`, { cwd: REPO_ROOT, stdio: 'ignore' });
    return 'signed';
  } catch {
    // unsigned or unverifiable — try the GitHub API
  }
  if (!slug || !token) return null;
  try {
    const out = execSync(
      'curl -sf -H "Authorization: Bearer $GATES_GH_TOKEN" ' +
        `"https://api.github.com/repos/${slug}/commits/${sha}" | ` +
        'jq -r \'(.author.login // "-") + " " + (.committer.login // "-")\'',
      {
        cwd: REPO_ROOT,
        shell: '/bin/bash',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, GATES_GH_TOKEN: token },
      },
    )
      .toString()
      .trim();
    const [authorLogin, committerLogin] = out.split(' ');
    if (authorLogin === allowedLogin && committerLogin === allowedLogin) return 'api';
  } catch {
    // API unreachable / commit unknown to GitHub — fall through
  }
  return null;
}

const violations = [];
const shas = commitsUnderReview();
const slug = repoSlug();
const token = process.env.GITHUB_TOKEN ?? '';

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
  const identity = authenticatedIdentity(sha, slug, token);
  if (identity === null) {
    violations.push(
      `${sha.slice(0, 12)}: email text matches but identity is UNAUTHENTICATED ` +
        `(unsigned, and GitHub does not link both author and committer to ${allowedLogin})`,
    );
  }
}

if (shas.length === 0) {
  console.warn('AUTHOR GATE: no commits under review (skip)');
  process.exit(0);
}
console.log(
  `AUTHOR GATE: checked ${shas.length} commit(s) - required identity: ${allowedLogin} ` +
    '(email match + signed OR GitHub-API-linked author and committer)',
);
failBlocking('AUTHOR GATE (WasewaseX only)', violations);
