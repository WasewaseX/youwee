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

const required = ['[Desktop Entry]', 'Categories=', 'Type=Application'];
// The fork builds the deb entry from a custom template; upstream ships
// src-tauri/linux/youwee.desktop with the same placeholder style. Both
// must keep the issue #127 Network category.
const tmplPath = path.join(REPO_ROOT, 'src-tauri/desktop/youwee.desktop.tmpl');
const desktopPath = path.join(REPO_ROOT, 'src-tauri/linux/youwee.desktop');
if (fs.existsSync(tmplPath)) {
  const tmpl = fs.readFileSync(tmplPath, 'utf8');
  for (const entry of [...required, 'Exec={{exec}}', 'Name={{name}}']) {
    if (!tmpl.includes(entry)) {
      violations.push(
        `src-tauri/desktop/youwee.desktop.tmpl: missing required entry "${entry}"`,
      );
    }
  }
  if (!tmpl.includes('Network;')) {
    violations.push(
      'src-tauri/desktop/youwee.desktop.tmpl: Categories must include Network; (issue #127)',
    );
  }
} else if (fs.existsSync(desktopPath)) {
  const desktop = fs.readFileSync(desktopPath, 'utf8');
  for (const entry of required) {
    if (!desktop.includes(entry)) {
      violations.push(
        `src-tauri/linux/youwee.desktop: missing required entry "${entry}"`,
      );
    }
  }
  if (!desktop.includes('Network;')) {
    violations.push(
      'src-tauri/linux/youwee.desktop: Categories must include Network; (issue #127)',
    );
  }
} else {
  violations.push(
    'no desktop entry template found (expected src-tauri/desktop/youwee.desktop.tmpl or src-tauri/linux/youwee.desktop, issue #127 regression)',
  );
}
failBlocking('RELEASE CONSISTENCY', violations);
