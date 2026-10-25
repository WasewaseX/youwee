// Gate: COMMIT HYGIENE (blocking) - Conventional Commits + no AI slop.
import { execSync } from 'node:child_process';
import {
  commitsUnderReview,
  failBlocking,
  isMergeCommit,
  loadGateConfig,
  REPO_ROOT,
} from './lib/scan-util.mjs';

const config = loadGateConfig();
const titlePattern = new RegExp(config.pr.titlePattern);
const slopPhrases = config.aiSlop.phrases;
const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

const violations = [];
const shas = commitsUnderReview();

for (const sha of shas) {
  if (isMergeCommit(sha)) continue;
  let subject;
  try {
    subject = execSync(`git log -1 --format=%s ${sha}`, { cwd: REPO_ROOT }).toString().trim();
  } catch {
    violations.push(`${sha.slice(0, 12)}: unable to read commit subject`);
    continue;
  }
  const short = sha.slice(0, 12);
  if (!titlePattern.test(subject)) {
    violations.push(`${short}: commit subject "${subject}" does not follow Conventional Commits`);
  }
  const lower = subject.toLowerCase();
  for (const phrase of slopPhrases) {
    if (lower.includes(phrase)) {
      violations.push(`${short}: AI-slop cliche in commit subject: "${phrase}"`);
    }
  }
  if (emojiRe.test(subject)) {
    violations.push(`${short}: emoji in commit subject (ai-slop tell)`);
  }
}

if (shas.length === 0) {
  console.warn('COMMIT GATES: no commits under review (skip)');
  process.exit(0);
}
failBlocking('COMMIT HYGIENE', violations);
