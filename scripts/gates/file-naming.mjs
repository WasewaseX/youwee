// Gate: FILE NAMING CONVENTIONS (blocking on changed files, ratcheted legacy)
// src/components/**/*.tsx must be PascalCase, EXCEPT src/components/ui/**
// (shadcn/ui generated files are kebab-case by design). Hooks use*.ts(x);
// lib files kebab-case; css kebab-case.
import {
  changedFiles,
  emitBaselineIfRequested,
  failBlocking,
  listTrackedFiles,
  ratchetViolations,
} from './lib/scan-util.mjs';

const changed = new Set(changedFiles());
const blocking = [];
const ratcheted = [];

for (const file of listTrackedFiles()) {
  const parts = file.split('/');
  const name = parts[parts.length - 1];
  const base = name.replace(/\.(ts|tsx|js|jsx|mjs|rs|css|json|md|yml|yaml|html|toml|txt|sh)$/, '');
  let violation = null;

  if (
    file.startsWith('src/components/') &&
    file.endsWith('.tsx') &&
    !file.startsWith('src/components/ui/') &&
    !/\.test\./.test(name)
  ) {
    if (!/^[A-Z][A-Za-z0-9]*\.tsx$/.test(name)) {
      violation = `${file}: component files must be PascalCase.tsx (shadcn ui/ is exempt)`;
    }
  }
  if (
    !violation &&
    /^src\/hooks\//.test(file) &&
    /\.(ts|tsx)$/.test(name) &&
    !/\.test\./.test(name)
  ) {
    if (!/^use[A-Z]/.test(base) && base !== 'index') {
      violation = `${file}: hooks must start with use (camelCase)`;
    }
  }
  if (
    !violation &&
    /^src\/lib\//.test(file) &&
    /\.(ts|tsx)$/.test(name) &&
    !/\.test\./.test(name)
  ) {
    if (!/^[a-z][a-z0-9.-]*\.(ts|tsx)$/.test(name)) {
      violation = `${file}: lib files must be kebab-case`;
    }
  }

  if (violation) {
    if (changed.has(file)) blocking.push(violation);
    else ratcheted.push(violation);
  }
}

const perFile = {};
for (const v of ratcheted) {
  const file = v.split(':')[0];
  perFile[file] = (perFile[file] ?? 0) + 1;
}
emitBaselineIfRequested({ 'style.fileNaming': { perFile } });
const violations = [
  ...blocking,
  ...ratchetViolations('style.fileNaming', perFile, { unit: 'naming violations' }),
];
failBlocking('FILE NAMING CONVENTIONS', violations);
