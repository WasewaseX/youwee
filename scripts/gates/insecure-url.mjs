// Gate: INSECURE URL SCAN (advisory)
// Flags plaintext http:// URLs in app code (localhost is allowed).
import {
  CODE_EXTENSIONS,
  finishAdvisory,
  listTrackedFiles,
  readRepoFile,
} from './lib/scan-util.mjs';

const warnings = [];
const allowRe =
  /localhost|127\.0\.0\.1|example\.com|www\.w3\.org|ns\.adobe|iptc\.org|imsglobal|purl\.org| dublincore/i;

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
    const m = /http:\/\/[^\s"'`)]+/.exec(lines[i]);
    if (m && !allowRe.test(m[0])) {
      warnings.push(`${file}:${i + 1}: plaintext http:// URL - prefer https://`);
    }
  }
}
finishAdvisory('INSECURE URL SCAN', warnings);
