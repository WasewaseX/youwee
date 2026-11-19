// Gate: IMPORT HYGIENE (advisory)
import {
  CODE_EXTENSIONS,
  finishAdvisory,
  listTrackedFiles,
  readRepoFile,
} from './lib/scan-util.mjs';

const warnings = [];
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
    const m = /(?:from|require\()\s*['"]((?:\.\.\/){3,})[^'"]+['"]/.exec(lines[i]);
    if (m) {
      warnings.push(`${file}:${i + 1}: deep relative import (${m[1]}) - use a path alias like @/`);
    }
  }
}
finishAdvisory('IMPORT HYGIENE', warnings);
