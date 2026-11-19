// Gate: XSS SINK SCAN (blocking, ratcheted)
// Flags dangerous DOM sinks: innerHTML, outerHTML, document.write,
// dangerouslySetInnerHTML, insertAdjacentHTML.
import {
  CODE_EXTENSIONS,
  emitBaselineIfRequested,
  failBlocking,
  listTrackedFiles,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const ratcheted = [];
const perFile = {};
const sinkRe =
  /\.(innerHTML|outerHTML)\s*=|document\.write\s*\(|insertAdjacentHTML\s*\(|dangerouslySetInnerHTML/;

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (sinkRe.test(lines[i])) {
      ratcheted.push(`${file}:${i + 1}: dangerous DOM sink - sanitize input or use safe APIs`);
    }
  }
}
for (const v of ratcheted) {
  const file = v.split(':')[0];
  perFile[file] = (perFile[file] ?? 0) + 1;
}
emitBaselineIfRequested({ 'security.xssSinks': { perFile } });
failBlocking('XSS SINK SCAN', ratchetViolations('security.xssSinks', perFile, { unit: 'sinks' }));
