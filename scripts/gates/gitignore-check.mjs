// Gate: GITIGNORE COVERAGE (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const giPath = path.join(REPO_ROOT, '.gitignore');
if (!fs.existsSync(giPath)) {
  violations.push('.gitignore missing');
} else {
  const content = fs.readFileSync(giPath, 'utf8');
  for (const required of ['node_modules', 'dist', 'target']) {
    if (!content.includes(required)) {
      violations.push(`.gitignore: missing required pattern "${required}"`);
    }
  }
}
failBlocking('GITIGNORE COVERAGE', violations);
