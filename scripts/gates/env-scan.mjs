// Gate: ENV ACCESS INVENTORY (advisory, ratcheted)
// Tracks import.meta.env / process.env usage outside allowlisted files.
import {
  CODE_EXTENSIONS,
  emitBaselineIfRequested,
  finishAdvisory,
  listTrackedFiles,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const perFile = {};
for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;
  if (/\.test\.|scripts\/|vite\.config/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  let n = 0;
  for (const line of content.split('\n')) {
    if (/import\.meta\.env\.|process\.env\./.test(line)) n += 1;
  }
  if (n > 0) perFile[file] = n;
}
emitBaselineIfRequested({ 'style.envAccess': { perFile } });
ratchetViolations('style.envAccess', perFile, { unit: 'env accesses' });
finishAdvisory('ENV ACCESS INVENTORY', []);
console.log(`ENV ACCESS: ${Object.keys(perFile).length} file(s) (ratcheted)`);
