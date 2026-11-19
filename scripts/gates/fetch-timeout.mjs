// Gate: FETCH TIMEOUT HEURISTIC (advisory)
// fetch() calls without an AbortSignal/timeout nearby can hang forever.
import { finishAdvisory, listTrackedFiles, readRepoFile } from './lib/scan-util.mjs';

const warnings = [];
for (const file of listTrackedFiles()) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/\bfetch\s*\(/.test(lines[i])) {
      const window = lines.slice(i, i + 8).join(' ');
      if (!/AbortSignal|signal|timeout|Timeout/.test(window)) {
        warnings.push(`${file}:${i + 1}: fetch() without visible timeout/abort handling`);
      }
    }
  }
}
finishAdvisory('FETCH TIMEOUT HEURISTIC', warnings);
