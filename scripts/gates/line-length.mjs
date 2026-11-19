// Gate: LINE LENGTH (advisory, ratcheted at 160 chars)
import {
  CODE_EXTENSIONS,
  emitBaselineIfRequested,
  listTrackedFiles,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const perFile = {};
for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (file.endsWith('.json')) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  let over = 0;
  for (const line of lines) {
    if (line.length > 160) over += 1;
  }
  if (over > 0) perFile[file] = over;
}
emitBaselineIfRequested({ 'style.lineLength': { perFile } });
const violations = ratchetViolations('style.lineLength', perFile, { unit: 'lines over 160 chars' });
console.log(
  violations.length === 0 ? 'OK LINE LENGTH: within ratchet' : 'WARN LINE LENGTH: ratchet exceeded',
);
if (violations.length > 0) {
  for (const v of violations) console.warn(`  ! ${v}`);
  process.exit(1);
}
