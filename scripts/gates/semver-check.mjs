// Gate: SEMVER FORMAT (blocking)
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const SEMVER = /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;
if (!SEMVER.test(pkg.version)) {
  violations.push(`package.json: version "${pkg.version}" is not valid semver`);
}
const tauri = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'src-tauri/tauri.conf.json'), 'utf8'),
);
if (!SEMVER.test(tauri.version)) {
  violations.push(`tauri.conf.json: version "${tauri.version}" is not valid semver`);
}
failBlocking('SEMVER FORMAT', violations);
