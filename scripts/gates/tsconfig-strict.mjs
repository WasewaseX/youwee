// Gate: TSCONFIG STRICTNESS (blocking)
// F9 (review): referenced TypeScript projects do NOT share options — each
// project's effective options are computed separately (extends chain
// resolved, project-local overrides applied). A later project setting
// strict:true can no longer mask an earlier project that disables it.
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];

/** JSONC comment stripping that respects string literals. The naive regex
 *  approach (block-comment first) also matches a comment opener INSIDE
 *  strings such as glob patterns or path aliases, cutting through the
 *  document and producing "Unterminated string" — the old scanner hid that
 *  behind a bare catch and silently skipped the very projects this gate
 *  must check. */
function stripJsonComments(text) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i + 2);
      i = end === -1 ? text.length : end;
      continue;
    }
    out += ch;
  }
  return out;
}

function readConf(absPath) {
  return JSON.parse(
    stripJsonComments(fs.readFileSync(absPath, 'utf8')).replace(/,(\s*[}\]])/g, '$1'),
  );
}

/** Effective compilerOptions for one tsconfig: extends chain, then own
 *  options (project-local values override the base). Guarded against
 *  extends cycles; unresolvable bases (e.g. node_modules packages) are
 *  skipped and their options simply do not contribute. */
function effectiveOptions(absPath, seen = new Set()) {
  if (seen.has(absPath)) return {};
  seen.add(absPath);
  let base = {};
  let conf;
  try {
    conf = readConf(absPath);
  } catch {
    return {};
  }
  if (conf.extends) {
    const exts = Array.isArray(conf.extends) ? conf.extends : [conf.extends];
    for (const e of exts) {
      const ep = path.resolve(path.dirname(absPath), e.endsWith('.json') ? e : `${e}.json`);
      if (fs.existsSync(ep)) {
        base = { ...base, ...effectiveOptions(ep, seen) };
      }
    }
  }
  return { ...base, ...(conf.compilerOptions ?? {}) };
}

const root = path.join(REPO_ROOT, 'tsconfig.json');
if (fs.existsSync(root)) {
  const projects = [{ name: 'tsconfig.json', path: root }];
  let rootConf;
  try {
    rootConf = readConf(root);
  } catch (e) {
    rootConf = {};
    violations.push(`tsconfig.json: invalid JSON - ${e.message}`);
  }
  for (const ref of rootConf.references ?? []) {
    const p = path.join(REPO_ROOT, ref.path.endsWith('.json') ? ref.path : `${ref.path}.json`);
    if (fs.existsSync(p)) projects.push({ name: ref.path, path: p });
    else violations.push(`tsconfig: referenced project ${ref.path} is missing`);
  }
  for (const proj of projects) {
    let conf;
    try {
      conf = readConf(proj.path);
    } catch {
      violations.push(`${proj.name}: invalid JSON`);
      continue;
    }
    // Solution-style roots (`files: []` + references) compile nothing
    // themselves — strictness is enforced on the projects that actually
    // hold sources.
    const solutionStyle = Array.isArray(conf.files) && conf.files.length === 0;
    if (solutionStyle) continue;
    const opts = effectiveOptions(proj.path);
    if (Object.keys(opts).length === 0) continue; // empty/invalid project config
    if (opts.strict !== true) {
      violations.push(`${proj.name}: strict mode must be enabled`);
    }
    if (opts.noEmit === false) {
      violations.push(`${proj.name}: noEmit should not be false`);
    }
  }
} else {
  violations.push('tsconfig.json missing');
}
failBlocking('TSCONFIG STRICTNESS', violations);
