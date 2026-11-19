// Shared utilities for youwee quality gate scanners.
// Every scanner: walks the repo, scans tracked files, and prints findings
// in a uniform format. Blocking scanners exit 1 on violation; advisory
// scanners print warnings and exit 0.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** File extensions considered "code" for slop/humanization scanning. */
export const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rs',
  '.css',
  '.json',
]);

/** Directories never scanned (vendor, build output, lockfiles, assets).
 *  `scripts/gates` is exempt from content scanning because the scanners'
 *  own sources legitimately contain the patterns they detect. Tamper
 *  protection for gate files is provided by .integrity/manifest.json. */
export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'target',
  '.git',
  '.github',
  '.integrity',
  'public',
  'icons',
  'snap',
  'flatpak',
  'bin',
  'coverage',
  'bun.lockb',
  'gates',
]);

/** List of tracked files, respecting SKIP_DIRS and extension filters. */
export function listTrackedFiles({ extensions = null, subdirs = null } = {}) {
  const out = execSync('git ls-files -z', { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split('\0')
    .filter(Boolean);
  return out.filter((rel) => {
    if (subdirs && !subdirs.some((d) => rel === d || rel.startsWith(`${d}/`))) return false;
    if (rel.includes('/node_modules/')) return false;
    const parts = rel.split('/');
    if (parts.some((p) => SKIP_DIRS.has(p))) return false;
    if (extensions) {
      const ext = path.extname(rel).toLowerCase();
      if (!extensions.has(ext)) return false;
    }
    return true;
  });
}

export function readRepoFile(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

export function fileExists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

export function loadBaselines() {
  const baselinePath = path.join(REPO_ROOT, 'scripts', 'gates', 'baselines.json');
  if (!fs.existsSync(baselinePath)) return {};
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

export function loadBaseline(gateName) {
  const all = loadBaselines();
  return all[gateName] ?? { perFile: {} };
}

export function loadGateConfig() {
  const configPath = path.join(REPO_ROOT, 'scripts', 'gates', 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

/**
 * Ratchet comparison: returns violations where the current count exceeds the
 * baseline. Files not present in the baseline must be at zero.
 */
export function ratchetViolations(gateName, currentPerFile, opts = {}) {
  const { unit = 'hits' } = opts;
  const baseline = loadBaseline(gateName);
  const violations = [];
  const seen = new Set();

  for (const [file, count] of Object.entries(currentPerFile)) {
    seen.add(file);
    const allowed = Number(baseline.perFile?.[file] ?? 0);
    if (count > allowed) {
      violations.push(
        file +
          ': ' +
          count +
          ' ' +
          unit +
          ' (ratchet allows ' +
          allowed +
          ') - fix the code or justify a baselines.json update in the PR description',
      );
    }
  }

  for (const file of Object.keys(baseline.perFile ?? {})) {
    if (!seen.has(file) && Number(baseline.perFile[file]) > 0 && !fileExists(file)) {
      console.warn(`stale baseline entry for deleted file ${file} (refresh baselines.json)`);
    }
  }
  return violations;
}

/** Consistent output helpers with GitHub Actions annotations. */
export function reportFindings(findings, { label } = {}) {
  for (const f of findings) {
    console.error(`  x ${f}`);
    const m = f.match(/^(.+?):(\d+):/);
    if (m) {
      const msg = f.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      console.log(
        '::error file=' +
          m[1] +
          ',line=' +
          m[2] +
          ',title=' +
          (label ?? 'gate violation') +
          '::' +
          msg,
      );
    }
  }
}

export function reportWarnings(warnings, { label } = {}) {
  for (const w of warnings) {
    console.warn(`  ! ${w}`);
    const m = w.match(/^(.+?):(\d+):/);
    if (m) {
      const msg = w.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      console.log(`::warning file=${m[1]},line=${m[2]},title=${label ?? 'advisory'}::${msg}`);
    }
  }
}

export function finishAdvisory(gateName, warnings) {
  if (warnings.length === 0) {
    console.log(`OK ${gateName}: clean`);
    return;
  }
  console.warn(`WARN ${gateName}: ${warnings.length} advisory finding(s) - not blocking`);
  reportWarnings(warnings, { label: gateName });
}

export function failBlocking(gateName, violations) {
  if (violations.length === 0) {
    console.log(`OK ${gateName}: clean`);
    return;
  }
  console.error(`FAIL ${gateName}: ${violations.length} violation(s)`);
  reportFindings(violations, { label: gateName });
  process.exit(1);
}

function emitBaselineIfRequested(payload) {
  if (process.env.GATES_EMIT_BASELINE === '1') {
    console.log(JSON.stringify(payload));
    process.exit(0);
  }
}

export { emitBaselineIfRequested };

/** Commits that are part of the change under review (PR or push). */
export function commitsUnderReview() {
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  if (event === 'pull_request') {
    const base = process.env.GITHUB_BASE_REF ?? 'main';
    execSync(`git fetch --no-tags origin ${base}`, { cwd: REPO_ROOT });
    return execSync(`git log --format=%H --no-merges origin/${base}..HEAD`, { cwd: REPO_ROOT })
      .toString()
      .split('\n')
      .filter(Boolean);
  }
  const sha = process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString().trim();
  return [sha];
}

/** Files changed by the change under review. */
export function changedFiles() {
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  if (event === 'pull_request') {
    // Prefer the GitHub API: shallow PR checkouts cannot always compute
    // three-dot merge bases locally.
    try {
      const eventPath = process.env.GITHUB_EVENT_PATH;
      const token = process.env.GITHUB_TOKEN ?? '';
      if (eventPath && fs.existsSync(eventPath) && token) {
        const ev = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
        const repo = ev.repository.full_name;
        const prNumber = ev.pull_request?.number ?? ev.number;
        if (repo && prNumber) {
          const out = execSync(
            'curl -sf -H "Authorization: Bearer ' +
              token +
              '" ' +
              '"https://api.github.com/repos/' +
              repo +
              '/pulls/' +
              prNumber +
              '/files?per_page=100" | jq -r ".[].filename"',
            { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024, shell: '/bin/bash' },
          ).toString();
          const files = out.split('\n').filter(Boolean);
          if (files.length > 0) return files;
        }
      }
    } catch {
      // fall through to git
    }
    const base = process.env.GITHUB_BASE_REF ?? 'main';
    try {
      execSync(`git fetch --no-tags origin ${base}`, { cwd: REPO_ROOT });
      return execSync(`git diff --name-only origin/${base}...HEAD`, {
        cwd: REPO_ROOT,
        maxBuffer: 16 * 1024 * 1024,
      })
        .toString()
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  const sha = process.env.GITHUB_SHA ?? 'HEAD';
  try {
    return execSync(`git diff --name-only ${sha}~1 ${sha}`, { cwd: REPO_ROOT })
      .toString()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** True when a commit has more than one parent (checkout merge refs). */
export function isMergeCommit(sha) {
  try {
    const parents = execSync(`git rev-list --parents -n 1 ${sha}`, { cwd: REPO_ROOT })
      .toString()
      .trim()
      .split(' ');
    return parents.length > 2;
  } catch {
    return false;
  }
}
