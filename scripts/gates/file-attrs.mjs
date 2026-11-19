// Gate: FILE ATTRIBUTES (blocking) - BOM, CRLF, symlinks, empty files.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, listTrackedFiles, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];

// Symlinks in tree
const lsOut = execSync('git ls-files -s', {
  cwd: REPO_ROOT,
  maxBuffer: 32 * 1024 * 1024,
}).toString();
for (const row of lsOut.split('\n').filter(Boolean)) {
  const mode = row.split(/\s+/)[0];
  if (mode === '120000') {
    violations.push(`${row.split(/\s+/).slice(3).join(' ')}: tracked symlink not allowed`);
  }
}

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.icns',
  '.webp',
  '.zip',
  '.tar',
  '.gz',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.pdf',
  '.webm',
  '.mp4',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.db',
  '.lockb',
]);
for (const file of listTrackedFiles()) {
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
  const buf = fs.readFileSync(path.join(REPO_ROOT, file));
  if (buf.length === 0) continue;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    violations.push(`${file}: UTF-8 BOM present - save as plain UTF-8`);
  }
  if (buf.includes(Buffer.from('\r\n'))) {
    violations.push(`${file}: CRLF line endings - use LF (.gitattributes enforces this)`);
  }
}
failBlocking('FILE ATTRIBUTES', violations);
