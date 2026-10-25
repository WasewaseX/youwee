// Gate: DOC RELATIVE LINKS (blocking)
// Relative links in README.md / CONTRIBUTING.md / docs/*.md must resolve.
import fs from 'node:fs';
import path from 'node:path';
import { failBlocking, REPO_ROOT } from './lib/scan-util.mjs';

const violations = [];
const docsFiles = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'PLUGINS.md'];
const docsDir = path.join(REPO_ROOT, 'docs');
if (fs.existsSync(docsDir)) {
  for (const f of fs.readdirSync(docsDir)) {
    if (f.endsWith('.md')) docsFiles.push(`docs/${f}`);
  }
}

for (const rel of docsFiles) {
  const p = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const content = fs.readFileSync(p, 'utf8');
  const dir = path.dirname(p);
  const re = /\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g;
  let m;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop idiom
  while ((m = re.exec(content)) !== null) {
    const target = m[1];
    if (/^https?:\/\//.test(target) || target.startsWith('mailto:')) continue;
    const resolved = path.resolve(dir, decodeURIComponent(target));
    if (!fs.existsSync(resolved)) {
      violations.push(`${rel}: broken relative link -> ${target}`);
    }
  }
}
failBlocking('DOC RELATIVE LINKS', violations);
