// Gate: NESTING DEPTH (advisory, ratcheted at 6 levels)
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
  if (!/\.(ts|tsx|js|jsx|mjs|rs)$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  let depth = 0;
  let worst = 0;
  for (const line of lines) {
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    worst = Math.max(worst, depth);
  }
  if (worst > 6) perFile[file] = worst - 6;
}
emitBaselineIfRequested({ 'style.nesting': { perFile } });
ratchetViolations('style.nesting', perFile, { unit: 'levels over 6' });
finishAdvisory('NESTING DEPTH', []);
console.log(`NESTING DEPTH: ${Object.keys(perFile).length} file(s) flagged (ratcheted)`);
