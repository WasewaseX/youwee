// Gate: CHANGELOG COVERAGE (advisory)
// The current app version should appear in CHANGELOG.md.
import fs from 'node:fs';
import path from 'node:path';
import { finishAdvisory, REPO_ROOT } from './lib/scan-util.mjs';

const warnings = [];
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const changelogPath = path.join(REPO_ROOT, 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
  const content = fs.readFileSync(changelogPath, 'utf8');
  if (!content.includes(pkg.version)) {
    warnings.push(`CHANGELOG.md does not mention current version ${pkg.version}`);
  }
} else {
  warnings.push('CHANGELOG.md missing');
}
finishAdvisory('CHANGELOG COVERAGE', warnings);
