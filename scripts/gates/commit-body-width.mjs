// Gate: COMMIT BODY WIDTH (advisory)
// Commit message body lines should stay under 100 characters.
import { execSync } from 'node:child_process';
import { commitsUnderReview, finishAdvisory, isMergeCommit, REPO_ROOT } from './lib/scan-util.mjs';

const warnings = [];
for (const sha of commitsUnderReview()) {
  if (isMergeCommit(sha)) continue;
  try {
    const body = execSync(`git log -1 --format=%b ${sha}`, { cwd: REPO_ROOT }).toString();
    body.split('\n').forEach((line, idx) => {
      if (line.length > 100) {
        warnings.push(
          sha.slice(0, 12) +
            ': body line ' +
            (idx + 1) +
            ' is ' +
            line.length +
            ' chars (keep under 100)',
        );
      }
    });
  } catch {}
}
finishAdvisory('COMMIT BODY WIDTH', warnings);
