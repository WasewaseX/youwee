// Gate: BLANK TARGET SAFETY (blocking, ratcheted)
// target="_blank" links must carry rel="noopener" or "noreferrer".
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

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (!/\.(ts|tsx|js|jsx|mjs|html)$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/target\s*=\s*["']?_blank["']?/i.test(lines[i])) {
      const window = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
      if (!/noopener|noreferrer/i.test(window)) {
        ratcheted.push(`${file}:${i + 1}: target=_blank without rel=noopener (reverse tabnabbing)`);
      }
    }
  }
}
for (const v of ratcheted) {
  const file = v.split(':')[0];
  perFile[file] = (perFile[file] ?? 0) + 1;
}
emitBaselineIfRequested({ 'security.blankTarget': { perFile } });
failBlocking(
  'BLANK TARGET SAFETY',
  ratchetViolations('security.blankTarget', perFile, { unit: 'unsafe targets' }),
);
