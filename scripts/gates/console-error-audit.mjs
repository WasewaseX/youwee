// Gate: CONSOLE.ERROR AUDIT (advisory, ratcheted)
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
  if (file.startsWith('scripts/')) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  let n = 0;
  for (const line of content.split('\n')) {
    if (/\bconsole\.(error|warn)\s*\(/.test(line)) n += 1;
  }
  if (n > 0) perFile[file] = n;
}
emitBaselineIfRequested({ 'style.consoleError': { perFile } });
ratchetViolations('style.consoleError', perFile, { unit: 'console.error/warn' });
finishAdvisory('CONSOLE.ERROR AUDIT', []);
console.log(`CONSOLE.ERROR AUDIT: ${Object.keys(perFile).length} file(s) (ratcheted)`);
