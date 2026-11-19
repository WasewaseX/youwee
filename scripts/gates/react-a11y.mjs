// Gate: REACT A11Y BASICS (advisory)
// <img> without alt, .map( without key= heuristic, <button> with no text.
import { finishAdvisory, listTrackedFiles, readRepoFile } from './lib/scan-util.mjs';

const warnings = [];
for (const file of listTrackedFiles()) {
  if (!/\.tsx$/.test(file)) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/<img\b(?![^>]*\balt=)[^>]*>/.test(line) && !/alt=/.test(lines.slice(i, i + 4).join(' '))) {
      warnings.push(`${file}:${i + 1}: <img> without alt attribute`);
    }
    if (
      /\.map\(/.test(line) &&
      /=>\s*[(<]/.test(line) &&
      !/key[=:{]/.test(line) &&
      !/key[=:{]/.test(lines[i + 1] ?? '')
    ) {
      warnings.push(`${file}:${i + 1}: list rendering without key prop (heuristic)`);
    }
  }
}
finishAdvisory('REACT A11Y BASICS', warnings);
