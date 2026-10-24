// Gate: HUMANIZED CODE CHECK (blocking, strict)
//   - filler comment openers ("This function ...")  -> ratcheted
//   - generic placeholder identifiers (foo, doStuff) -> ratcheted

import {
  CODE_EXTENSIONS,
  emitBaselineIfRequested,
  failBlocking,
  listTrackedFiles,
  loadGateConfig,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const config = loadGateConfig();
const { commentFillers, genericIdentifiers } = config.aiSlop;

const ratcheted = [];
const genericSet = new Set(genericIdentifiers.map((g) => g.toLowerCase()));
const declareRe = /\b(const|let|var|function|class|fn)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    if (isComment) {
      const lower = trimmed.toLowerCase();
      for (const filler of commentFillers) {
        if (lower.includes(filler)) {
          ratcheted.push(
            file +
              ':' +
              (i + 1) +
              ': filler comment opener "' +
              filler +
              '" - explain WHY, not WHAT',
          );
        }
      }
    }
    if (!/^\s*(import|export)\b/.test(line)) {
      const declares = declareRe.exec(line);
      if (declares && genericSet.has(declares[2].toLowerCase())) {
        ratcheted.push(
          file +
            ':' +
            (i + 1) +
            ': placeholder identifier "' +
            declares[2] +
            '" - use a domain-specific name',
        );
      }
    }
  }
}

const perFile = {};
for (const v of ratcheted) {
  const file = v.split(':')[0];
  perFile[file] = (perFile[file] ?? 0) + 1;
}

emitBaselineIfRequested({ 'humanized.filler': { perFile } });

const violations = ratchetViolations('humanized.filler', perFile, { unit: 'filler hits' });
failBlocking('HUMANIZED CODE CHECK', violations);
