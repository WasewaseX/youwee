// Gate: TSCONFIG STRICTNESS (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const root = path.join(REPO_ROOT, 'tsconfig.json');
if (fs.existsSync(root)) {
  const raw = fs
    .readFileSync(root, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const conf = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1'));
  const opts = { ...(conf.compilerOptions ?? {}) };
  for (const ref of conf.references ?? []) {
    const p = path.join(REPO_ROOT, ref.path.endsWith('.json') ? ref.path : `${ref.path}.json`);
    if (fs.existsSync(p)) {
      const childRaw = fs
        .readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      try {
        const child = JSON.parse(childRaw.replace(/,(\s*[}\]])/g, '$1'));
        Object.assign(opts, child.compilerOptions ?? {});
      } catch {}
    }
  }
  if (opts.strict !== true) violations.push('tsconfig: strict mode must be enabled');
  if (opts.noEmit === false) violations.push('tsconfig: noEmit should not be false');
} else {
  violations.push('tsconfig.json missing');
}
failBlocking('TSCONFIG STRICTNESS', violations);
