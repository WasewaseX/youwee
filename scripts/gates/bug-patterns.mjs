// Gate: BUG PATTERN DETECTOR (blocking, changed-vs-legacy ratchet)
// NEW occurrences in changed files block; legacy occurrences are ratcheted.

import {
  CODE_EXTENSIONS,
  changedFiles,
  emitBaselineIfRequested,
  failBlocking,
  listTrackedFiles,
  ratchetViolations,
  readRepoFile,
} from './lib/scan-util.mjs';

const zeroTolerance = [];
const counters = {
  'bug.emptyCatch': {},
  'bug.swallowCatch': {},
  'bug.eval': {},
  'bug.consoleLog': {},
  'bug.looseEquality': {},
  'bug.todo': {},
};

const changed = new Set(changedFiles());

function pushFinding(bucket, file, line, message, isChangedFile) {
  const hit = `${file}:${line}: ${message}`;
  if (isChangedFile) {
    zeroTolerance.push(hit);
  } else {
    counters[bucket][file] = (counters[bucket][file] ?? 0) + 1;
  }
}

for (const file of listTrackedFiles({ extensions: CODE_EXTENSIONS })) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
  let content;
  try {
    content = readRepoFile(file);
  } catch {
    continue;
  }
  const lines = content.split('\n');
  const isRust = file.endsWith('.rs');
  const isAppCode = file.startsWith('src/') || file.startsWith('sdk-js/');
  const isScript = file.startsWith('scripts/');
  const isChanged = changed.has(file);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/\bdebugger\b/.test(line) && !isRust) {
      pushFinding('bug.debugger', file, i + 1, 'debugger statement', isChanged);
    }
    if (/^<{7}|^={7}$|^>{7}/.test(line.trim())) {
      pushFinding('bug.conflictMarker', file, i + 1, 'unresolved merge-conflict marker', isChanged);
    }
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line) && !isRust) {
      pushFinding('bug.emptyCatch', file, i + 1, 'empty catch block swallows errors', isChanged);
    }
    if (/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(line) && !isRust) {
      pushFinding('bug.swallowCatch', file, i + 1, '.catch(() => {}) swallows errors', isChanged);
    }
    if (/\beval\s*\(|new\s+Function\s*\(/.test(line) && (isAppCode || isScript) && !isRust) {
      pushFinding('bug.eval', file, i + 1, 'eval / new Function is banned', isChanged);
    }
    if (isAppCode && !isRust && /\bconsole\.log\s*\(/.test(line)) {
      pushFinding('bug.consoleLog', file, i + 1, 'console.log in app code', isChanged);
    }
    if (!isRust && /[^=!<>]==[^=]/.test(line.replace(/(["'])(?:(?!\1).)*\1/g, '""'))) {
      pushFinding('bug.looseEquality', file, i + 1, 'loose equality (==/!=) - use ===/!==', false);
    }
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
      pushFinding('bug.todo', file, i + 1, 'TODO/FIXME marker present', false);
    }
  }
}

delete counters['bug.debugger'];
delete counters['bug.conflictMarker'];

emitBaselineIfRequested(
  Object.fromEntries(Object.entries(counters).map(([gate, perFile]) => [gate, { perFile }])),
);

const violations = [...zeroTolerance];
for (const [gate, perFile] of Object.entries(counters)) {
  violations.push(...ratchetViolations(gate, perFile, { unit: gate.split('.')[1] }));
}
failBlocking('BUG PATTERN DETECTOR', violations);
