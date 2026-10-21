// Gate: UNUSED I18N KEYS (advisory, ratcheted)
import fs from 'node:fs';
import path from 'node:path';
import {
  emitBaselineIfRequested,
  finishAdvisory,
  REPO_ROOT,
  ratchetViolations,
} from './lib/scan-util.mjs';

const localesDir = path.join(REPO_ROOT, 'src', 'i18n', 'locales');
const srcDir = path.join(REPO_ROOT, 'src');
const perFile = {};

function flatten(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') keys.push(...flatten(v, key));
    else keys.push(key);
  }
  return keys;
}

let corpus = '';
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales' || entry.name === 'node_modules') continue;
      walk(p);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      corpus += fs.readFileSync(p, 'utf8');
    }
  }
}
walk(srcDir);
try {
  corpus += fs.readFileSync(path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8');
} catch {}

const enDir = path.join(localesDir, 'en');
if (fs.existsSync(enDir)) {
  for (const jsonFile of fs.readdirSync(enDir)) {
    if (!jsonFile.endsWith('.json')) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(enDir, jsonFile), 'utf8'));
    } catch {
      continue;
    }
    const ns = jsonFile.replace(/\.json$/, '');
    const keys = flatten(data);
    let unused = 0;
    for (const key of keys) {
      const withoutNs = key.startsWith(`${ns}.`) ? key.slice(ns.length + 1) : key;
      const leaf = key.split('.').pop();
      if (
        !corpus.includes(`'${withoutNs}'`) &&
        !corpus.includes(`"${withoutNs}"`) &&
        !corpus.includes(leaf)
      ) {
        unused += 1;
      }
    }
    if (unused > 0) perFile[`en/${jsonFile}`] = unused;
  }
}

emitBaselineIfRequested({ 'i18n.unused': { perFile } });
ratchetViolations('i18n.unused', perFile, { unit: 'unused keys' });
finishAdvisory('UNUSED I18N KEYS', []);
console.log(`UNUSED I18N KEYS: ${Object.keys(perFile).length} namespace(s) flagged (ratcheted)`);
