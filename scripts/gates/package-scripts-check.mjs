// Gate: PACKAGE SCRIPTS (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const pkgPath = path.join(REPO_ROOT, 'package.json');
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const script of ['dev', 'build', 'test', 'lint']) {
    if (!pkg.scripts?.[script]) {
      violations.push(`package.json: missing required script "${script}"`);
    }
  }
} catch (e) {
  violations.push(`package.json: unreadable - ${e.message}`);
}
failBlocking('PACKAGE SCRIPTS', violations);
