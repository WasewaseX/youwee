// Gate: WORKFLOW ACTION PINNING (blocking)
// Third-party actions must be pinned to a version tag or SHA, never a
// moving branch reference.
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const wfDir = path.join(REPO_ROOT, '.github', 'workflows');
if (fs.existsSync(wfDir)) {
  for (const f of fs.readdirSync(wfDir)) {
    if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
    const content = fs.readFileSync(path.join(wfDir, f), 'utf8');
    const re = /uses:\s*([^\s]+)@([^\s]+)/g;
    let m;
    // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop idiom
    while ((m = re.exec(content)) !== null) {
      const ref = m[2];
      if (ref === 'main' || ref === 'master' || ref === 'latest' || ref === 'dev') {
        violations.push(
          '.github/workflows/' +
            f +
            ': action "' +
            m[1] +
            '" pinned to moving ref "' +
            ref +
            '" - pin a tag or SHA',
        );
      }
    }
  }
}
failBlocking('WORKFLOW ACTION PINNING', violations);
