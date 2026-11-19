// Gate: CONTRIBUTING.md COVERAGE (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const requiredSections = [
  { re: /##\s+.*Quality Gate System/i, why: 'Quality Gate System overview section' },
  { re: /##\s+.*Author Requirement|WasewaseX/i, why: 'author requirement (WasewaseX identity)' },
  { re: /AI-slop|AI slop/i, why: 'AI-slop policy' },
  { re: /Conventional Commits/i, why: 'commit convention' },
  { re: /baselines\.json|ratchet/i, why: 'ratchet / baseline policy' },
  { re: /\.integrity\/manifest\.json|integrity/i, why: 'integrity manifest policy' },
  { re: /##\s+.*Pull Request|PR process/i, why: 'PR process section' },
];

const violations = [];
const contributingPath = path.join(REPO_ROOT, 'CONTRIBUTING.md');
if (!fs.existsSync(contributingPath)) {
  violations.push('CONTRIBUTING.md: file missing');
} else {
  const content = fs.readFileSync(contributingPath, 'utf8');
  for (const { re, why } of requiredSections) {
    if (!re.test(content)) {
      violations.push(`CONTRIBUTING.md: missing required section/content - ${why}`);
    }
  }
  const gatesDir = path.join(REPO_ROOT, 'scripts', 'gates');
  const scanners = fs
    .readdirSync(gatesDir)
    .filter(
      (f) =>
        f.endsWith('.mjs') && f !== 'integrity-generate.mjs' && f !== 'calibrate-baselines.mjs',
    );
  for (const scanner of scanners) {
    if (!content.includes(scanner)) {
      violations.push(`CONTRIBUTING.md: gate script not documented: ${scanner}`);
    }
  }
}
failBlocking('CONTRIBUTING COVERAGE', violations);
