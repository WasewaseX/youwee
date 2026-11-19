// Gate: REPO HYGIENE (blocking)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const tracked = execSync('git ls-files -z', { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 })
  .toString()
  .split('\0')
  .filter(Boolean);

const forbidden = [
  /^dist\//,
  /^src-tauri\/target\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.env($|\.)/,
  /\.(log|tmp|bak)$/i,
];
for (const file of tracked) {
  if (forbidden.some((re) => re.test(file))) {
    violations.push(`${file}: forbidden tracked file (build artifact / secret env / temp)`);
  }
}

const MAX_BYTES = 2 * 1024 * 1024;
const binaryish = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.icns',
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
];
for (const file of tracked) {
  if (!binaryish.includes(path.extname(file).toLowerCase())) continue;
  const size = fs.statSync(path.join(REPO_ROOT, file)).size;
  if (size > MAX_BYTES) {
    violations.push(`${file}: binary asset is ${(size / 1024 / 1024).toFixed(1)}MB (limit 2MB)`);
  }
}
failBlocking('REPO HYGIENE', violations);
