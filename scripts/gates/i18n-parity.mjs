// Gate: I18N PARITY (blocking, ratcheted)
import fs from 'node:fs';
import path from 'node:path';
import {
  emitBaselineIfRequested,
  failBlocking,
  REPO_ROOT,
  ratchetViolations,
} from './lib/scan-util.mjs';

const localesDir = path.join(REPO_ROOT, 'src', 'i18n', 'locales');

function flatten(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') keys.push(...flatten(v, key));
    else keys.push(key);
  }
  return keys.sort();
}

const violations = [];
const perFile = {};
const locales = fs
  .readdirSync(localesDir)
  .filter((d) => fs.statSync(path.join(localesDir, d)).isDirectory())
  .sort();

// Deterministic reference locale: 'en' (fallbackLng). Directory iteration
// order differs across machines, so never rely on readdir order here.
const REFERENCE_LOCALE = 'en';
const reference = new Map();
for (const locale of locales) {
  for (const jsonFile of fs.readdirSync(path.join(localesDir, locale))) {
    if (!jsonFile.endsWith('.json')) continue;
    const rel = `${locale}/${jsonFile}`;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(localesDir, locale, jsonFile), 'utf8'));
    } catch (e) {
      violations.push(`${rel}: invalid JSON - ${e.message}`);
      continue;
    }
    const keys = flatten(data);
    if (locale === REFERENCE_LOCALE) {
      reference.set(jsonFile, { keys: new Set(keys), locale });
      continue;
    }
    if (!reference.has(jsonFile)) continue;
    const ref = reference.get(jsonFile);
    const refSet = ref.keys;
    const mine = new Set(keys);
    let drift = 0;
    for (const k of refSet) {
      if (!mine.has(k)) {
        violations.push(`${rel}: missing translation key "${k}" (present in ${ref.locale})`);
        drift += 1;
      }
    }
    for (const k of mine) {
      if (!refSet.has(k)) {
        violations.push(`${rel}: extra key "${k}" not present in ${ref.locale}`);
        drift += 1;
      }
    }
    if (drift > 0) perFile[rel] = drift;
  }
}

emitBaselineIfRequested({ 'i18n.drift': { perFile } });

const ratchet = ratchetViolations('i18n.drift', perFile, { unit: 'key drift' });
console.log(`I18N PARITY: checked ${locales.length} locales across ${reference.size} namespaces`);
failBlocking('I18N PARITY', [...violations.filter((v) => v.includes('invalid JSON')), ...ratchet]);
