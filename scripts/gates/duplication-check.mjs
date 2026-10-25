// Gate: DUPLICATED BLOCKS (advisory, ratcheted)
// Naive 8-line block duplication detector within src/.

import crypto from 'node:crypto';
import {
  emitBaselineIfRequested,
  finishAdvisory,
  listTrackedFiles,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const WINDOW = 8;
const seen = new Map();
const perFile = {};

for (const file of listTrackedFiles()) {
  if (!/\.(ts|tsx|js|jsx|mjs|rs)$/.test(file)) continue;
  if (!file.startsWith('src/')) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = 0; i + WINDOW <= lines.length; i += 1) {
    const block = lines.slice(i, i + WINDOW).join('\n');
    if (block.split('\n').filter((l) => l.length < 4).length > 2) continue;
    const hash = crypto.createHash('sha1').update(block).digest('hex');
    if (seen.has(hash) && seen.get(hash).file !== file) {
      perFile[file] = (perFile[file] ?? 0) + 1;
    } else {
      seen.set(hash, { file });
    }
  }
}
emitBaselineIfRequested({ 'style.duplication': { perFile } });
ratchetViolations('style.duplication', perFile, { unit: 'duplicated blocks' });
finishAdvisory('DUPLICATED BLOCKS', []);
console.log(`DUPLICATED BLOCKS: ${Object.keys(perFile).length} file(s) (ratcheted)`);
