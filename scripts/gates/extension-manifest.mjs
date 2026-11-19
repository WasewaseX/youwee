// Gate: EXTENSION MANIFEST VALIDATION (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const extDir = path.join(REPO_ROOT, 'extensions');
if (fs.existsSync(extDir)) {
  for (const dir of fs.readdirSync(extDir)) {
    const manifestPath = path.join(extDir, dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let m;
    try {
      m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      violations.push(`extensions/${dir}/manifest.json: invalid JSON - ${e.message}`);
      continue;
    }
    if (!m.manifest_version)
      violations.push(`extensions/${dir}/manifest.json: missing manifest_version`);
    if (!m.name) violations.push(`extensions/${dir}/manifest.json: missing name`);
    if (!m.version || !/^\d+(\.\d+){2,3}/.test(m.version)) {
      violations.push(`extensions/${dir}/manifest.json: missing or malformed version`);
    }
  }
}
failBlocking('EXTENSION MANIFEST VALIDATION', violations);
