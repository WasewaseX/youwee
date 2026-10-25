// Gate: RELEASE CONSISTENCY (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

const pkg = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
if (pkg.version !== tauri.version) {
  violations.push(`version mismatch: package.json=${pkg.version} tauri.conf.json=${tauri.version}`);
}
const cargoToml = fs.readFileSync(path.join(REPO_ROOT, 'src-tauri/Cargo.toml'), 'utf8');
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
if (cargoVersion && cargoVersion !== tauri.version) {
  violations.push(`version mismatch: Cargo.toml=${cargoVersion} tauri.conf.json=${tauri.version}`);
}

const tmplPath = path.join(REPO_ROOT, 'src-tauri/desktop/youwee.desktop.tmpl');
if (fs.existsSync(tmplPath)) {
  const tmpl = fs.readFileSync(tmplPath, 'utf8');
  for (const required of [
    '[Desktop Entry]',
    'Categories=',
    'Exec={{exec}}',
    'Name={{name}}',
    'Type=Application',
  ]) {
    if (!tmpl.includes(required)) {
      violations.push(
        `src-tauri/desktop/youwee.desktop.tmpl: missing required entry "${required}"`,
      );
    }
  }
  if (!tmpl.includes('Network;')) {
    violations.push(
      'src-tauri/desktop/youwee.desktop.tmpl: Categories must include Network; (issue #127)',
    );
  }
} else {
  violations.push('src-tauri/desktop/youwee.desktop.tmpl: file missing (issue #127 regression)');
}
failBlocking('RELEASE CONSISTENCY', violations);
