// Gate: MAGIC NUMBERS (advisory, ratcheted)
// Unexplained numeric literals outside 0/1/-1/10/100 in app logic.
import {
  CODE_EXTENSIONS,
  emitBaselineIfRequested,
  finishAdvisory,
  listTrackedFiles,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const perFile = {};
const allowed = new Set(['0', '1', '-1', '2', '10', '100', '1000', '0x00', '200', '404', '500']);

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;
  if (file.includes('.test.')) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/(["'`])(?:(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '');
    const re = /\b(\d{3,})\b/g;
    let m;
    // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop idiom
    while ((m = re.exec(line)) !== null) {
      if (!allowed.has(m[1]) && !/^\d{4}$/.test(m[1])) count += 1;
    }
  }
  if (count > 0) perFile[file] = count;
}
emitBaselineIfRequested({ 'style.magicNumbers': { perFile } });
ratchetViolations('style.magicNumbers', perFile, { unit: 'magic numbers' });
finishAdvisory('MAGIC NUMBERS', []);
console.log(`MAGIC NUMBERS: ${Object.keys(perFile).length} file(s) flagged (ratcheted)`);
