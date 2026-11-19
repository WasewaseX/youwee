// Gate: FILE SIZE LIMIT (hard limit + ratcheted soft limit)
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
const hardLimit = config.fileSize.hardLimitLines;
const hardViolations = [];
const perFile = {};

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lineCount = content.split('\n').length;
  if (lineCount > hardLimit) {
    hardViolations.push(`${file}:1: ${lineCount} lines exceeds hard limit of ${hardLimit}`);
  }
  if (lineCount > 800) {
    perFile[file] = lineCount - 800;
  }
}

emitBaselineIfRequested({ 'fileSize.over800': { perFile } });

const ratchet = ratchetViolations('fileSize.over800', perFile, { unit: 'lines over 800' });
failBlocking('FILE SIZE LIMIT', [...hardViolations, ...ratchet]);
