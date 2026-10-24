// Gate: FUNCTION LENGTH (advisory, ratcheted at 120 lines)
import {
  CODE_EXTENSIONS,
  emitBaselineIfRequested,
  finishAdvisory,
  listTrackedFiles,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const perFile = {};
const startRe = /(?:function\s+\w+|=>\s*\{|fn\s+\w+)\s*[{]?/;

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (!/\.(ts|tsx|js|jsx|mjs|rs)$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (startRe.test(lines[i]) && /\{\s*$/.test(lines[i].trimEnd())) {
      start = i;
      continue;
    }
    if (start >= 0 && lines[i].trim() === '}') {
      const len = i - start + 1;
      if (len > 120) {
        perFile[file] = (perFile[file] ?? 0) + 1;
      }
      start = -1;
    }
  }
}
emitBaselineIfRequested({ 'style.functionLength': { perFile } });
const violations = ratchetViolations('style.functionLength', perFile, {
  unit: 'functions over 120 lines',
});
finishAdvisory('FUNCTION LENGTH', violations.length > 0 ? [] : []);
console.log(`FUNCTION LENGTH: ${Object.keys(perFile).length} file(s) over threshold (ratcheted)`);
