// Gate: TS ESCAPE-HATCH AUDIT (advisory, ratcheted)
// Tracks total `as any` / @ts-expect-error / @ts-expect-error occurrences.
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
  if (!/\.(ts|tsx)$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  let n = 0;
  for (const line of content.split('\n')) {
    if (/\bas any\b/.test(line)) n += 1;
    if (/@ts-ignore|@ts-expect-error/.test(line)) n += 1;
  }
  if (n > 0) perFile[file] = n;
}
emitBaselineIfRequested({ 'style.tsEscapes': { perFile } });
ratchetViolations('style.tsEscapes', perFile, { unit: 'escape hatches' });
finishAdvisory('TS ESCAPE-HATCH AUDIT', []);
console.log(`TS ESCAPE-HATCH AUDIT: ${Object.keys(perFile).length} file(s) (ratcheted)`);
