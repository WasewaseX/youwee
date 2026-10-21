// Gate: TAURI CONFIG & CAPABILITIES (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const confPath = path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json');
let conf;
try {
  conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
} catch (e) {
  violations.push(`tauri.conf.json: invalid JSON - ${e.message}`);
  failBlocking('TAURI CONFIG & CAPABILITIES', violations);
}

for (const key of ['productName', 'version', 'identifier', 'build', 'app', 'bundle']) {
  if (!(key in conf)) violations.push(`tauri.conf.json: missing required key "${key}"`);
}
if (conf.bundle?.active !== true) violations.push('tauri.conf.json: bundle.active must be true');
if (!Array.isArray(conf.bundle?.targets) || conf.bundle.targets.length === 0) {
  violations.push('tauri.conf.json: bundle.targets must list at least one target');
}

// Icons referenced by config must exist.
for (const icon of conf.bundle?.icon ?? []) {
  if (!fs.existsSync(path.join(REPO_ROOT, 'src-tauri', icon))) {
    violations.push(`tauri.conf.json: icon not found: ${icon}`);
  }
}

// Capabilities must be valid JSON with known permission shapes.
const capDir = path.join(REPO_ROOT, 'src-tauri', 'capabilities');
if (fs.existsSync(capDir)) {
  for (const f of fs.readdirSync(capDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const cap = JSON.parse(fs.readFileSync(path.join(capDir, f), 'utf8'));
      if (!cap.identifier) violations.push(`src-tauri/capabilities/${f}: missing identifier`);
      if (!Array.isArray(cap.permissions))
        violations.push(`src-tauri/capabilities/${f}: permissions must be an array`);
    } catch (e) {
      violations.push(`src-tauri/capabilities/${f}: invalid JSON - ${e.message}`);
    }
  }
} else {
  violations.push('src-tauri/capabilities: directory missing');
}
failBlocking('TAURI CONFIG & CAPABILITIES', violations);
