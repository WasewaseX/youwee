# Contributing to Youwee (WasewaseX fork)

Welcome, and thank you for considering a contribution. This fork runs a
tiered CI system of 89 gates that every pull request must survive before it
can be merged. This document is the binding contract: it explains the rules,
the gates that enforce them, and the exact workflow for getting changes
merged. If you change how the gates work, you **must** update this document
in the same pull request — the `g32 contributing-coverage` gate fails
otherwise. Documentation and enforcement are kept in lockstep on purpose.

## Getting Started

1. Fork the repository and clone your fork.
2. Create a feature branch from `main` following the branch naming scheme:
   `git checkout main && git pull origin main && git checkout -b fix/my-fix`
   or `feat/my-feature`. Branch names must start with a Conventional Commit
   type (`feat/`, `fix/`, `docs/`, `chore/`, ...).
3. Install dependencies: `bun install --frozen-lockfile` (Bun is required; a
   Rust toolchain is needed only when you touch `src-tauri/`).
4. Make your changes.
5. Run the pre-flight checks locally before pushing:

   ```bash
   bun run lint          # Biome lint + format
   bunx tsc -b           # TypeScript strict type check
   bun run build:sdk     # build the SDK (required before tests)
   bun test              # Frontend test suite
   bun run build         # Frontend production build
   cd src-tauri && cargo check && cargo test && cargo fmt --check && cargo clippy -- -D warnings
   for s in scripts/gates/*.mjs; do bun "$s" || exit 1; done   # where applicable
   ```

6. Commit your changes (see the commit rules below) and push.
7. Open a Pull Request **against this fork's `main` branch**.

## Pull Request Process

- Always branch from the latest `main` and keep your branch rebased while you
  work so the PR stays mergeable.
- One logical change per PR. The PR size budget is 4,000 added lines; larger
  changes should be split into stacked pull requests.
- The PR title must follow Conventional Commits exactly like commit subjects
  (`fix(ui): show-in-folder button does nothing on macOS`).
- The PR body must describe the motivation, the approach, and how you tested
  it, and must link the issue it closes (`Fixes #123`).
- All blocking gates (see below) must be green before merge. Advisory gates
  produce warnings only, but their finding counts are ratcheted: keep them
  falling, never rising.
- Do not merge directly into `main`; the gatekeeper job exists to be seen.

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new features
- `fix:` — bug fixes
- `docs:` — documentation changes
- `style:` — code style changes (formatting, etc.)
- `refactor:` — code refactoring
- `perf:` — performance improvements
- `test:` — test additions or corrections
- `build:` / `ci:` — build system / CI changes
- `chore:` — maintenance
- `revert:` — reverts

Rules enforced by `g26 commit-hygiene` (`scripts/gates/commit-gates.mjs`):

- Subject format: `type(scope)?: description` (4–120 chars).
- No AI-slop clichés and no emoji in commit subjects.
- Every commit under review must be authored **and** committed by WasewaseX —
  see the next section.
- `g27 commit-body-width` (`scripts/gates/commit-body-width.mjs`) advises
  keeping body lines under 100 characters.

## Author Requirement

**Every commit must be authored and committed by `WasewaseX`**
(`321686523+WasewaseX@users.noreply.github.com`). This is a hard, blocking
gate (`g25 author-gate-wasewasex`, implemented in
`scripts/gates/author-gate.mjs`). There are no bot exceptions. Configure your
local git identity before committing:

```bash
git config user.name "WasewaseX"
git config user.email "321686523+WasewaseX@users.noreply.github.com"
```

Commits authored by any other identity will fail the gate and the PR cannot be
merged until the history is rewritten.

## Quality Gate System

The system lives in `.github/workflows/quality-gates.yml` and
`scripts/gates/`. It is **tiered**:

- **Blocking gates** — must pass; any failure blocks the merge (the
  `GATEKEEPER` job aggregates them).
- **Advisory gates** — report findings as warnings; nothing blocks, but the
  ratchet (see below) ensures findings only decrease over time.

### Ratchet model (baselines.json)

This fork inherits a large, mature upstream codebase. Gates that would flood
red on day one (legacy `console.log`, loose equality, oversized files,
translation drift, comment walls, DOM sinks) use a **ratchet**: the current
count of offending items per file is pinned in `scripts/gates/baselines.json`
(`scripts/gates/calibrate-baselines.mjs` regenerates it). A gate fails only
when the count **grows**. Cleaning up legacy items is always welcome — counts
are allowed to fall. Never raise a baseline to sneak a violation in; justify
every baseline change in the PR description.

Zero-tolerance findings (AI markers, emoji in code prose, debugger statements,
unresolved merge-conflict markers, secrets, new empty catch blocks in changed
files) are never baselined — they block immediately.

### Gate catalogue

**Foundation & build (blocking)** — `g01`–`g10`: install-clean,
lockfile-untouched, typecheck, biome-check, biome-format, unit-tests,
frontend-build, plugin-store-validate, extension-build, sdk-build.

**AI-slop & humanized code (blocking)** — `g11` `scripts/gates/ai-slop.mjs`
(clichés, placeholders, emoji, comment walls), `g12`
`scripts/gates/humanized-code.mjs` (filler comments, placeholder
identifiers), `g13` `scripts/gates/emoji-ban.mjs` (emoji-in-code-ban), `g14` placeholder-ban.

**Bug patterns (blocking)** — `g15` `scripts/gates/bug-patterns.mjs` (empty
catch, eval, console.log, loose equality, TODO), `g16` debugger-ban, `g17`
merge-conflict-markers, `g18` unsafe-regex-scan, `g19` todo-quota (advisory).

**Security (blocking)** — `g20` `scripts/gates/secret-patterns.mjs`, `g21`
`scripts/gates/xss-patterns.mjs` (DOM sinks), `g22`
`scripts/gates/blank-target-safety.mjs` (noopener), `g23`
`scripts/gates/insecure-url.mjs` (advisory), `g24` hardcoded-paths (advisory),
plus tools: gitleaks, Trivy vulnerability + secret scans.

**Author & integrity (blocking)** — `g25` `scripts/gates/author-gate.mjs`,
`g26` `scripts/gates/commit-gates.mjs`, `g29`
`scripts/gates/integrity-gate.mjs`, `g30` `scripts/gates/protected-paths.mjs`,
`g31` `scripts/gates/workflow-pinning.mjs`; `g27`
`scripts/gates/commit-body-width.mjs` and `g28` commit-signature are advisory.

**Docs & consistency (blocking)** — `g32` `scripts/gates/docs-gate.mjs`, `g33`
`scripts/gates/i18n-parity.mjs`, `g35` `scripts/gates/release-consistency.mjs`,
`g36` `scripts/gates/repo-hygiene.mjs`, `g37` `scripts/gates/file-attrs.mjs`
(BOM/CRLF/symlinks), `g38` `scripts/gates/file-naming.mjs`, `g39`
agents-md-present, `g40` license-present, `g41` gitattributes-present, `g42`
`scripts/gates/gitignore-check.mjs`, `g43`
`scripts/gates/package-scripts-check.mjs`, `g45` `scripts/gates/file-size.mjs`
(file-size-limit), `g50`
`scripts/gates/readme-links.mjs`; `g34` `scripts/gates/unused-i18n.mjs` and
`g44` `scripts/gates/changelog-check.mjs` are advisory.

**Config integrity (blocking)** — `g46`
`scripts/gates/tauri-config-check.mjs`, `g47`
`scripts/gates/extension-manifest.mjs`, `g48`
`scripts/gates/dependency-budget.mjs` (single lockfile + dependency budget),
`g49` `scripts/gates/tsconfig-strict.mjs`, and the `semver-check`
(`scripts/gates/semver-check.mjs`) version validation.

**Syntax sweeps** — `g51` json-valid (blocking), `g52` yaml-valid (advisory),
`g53` markdown-lint (advisory), `g54` editorconfig (advisory), `g55`
`scripts/gates/import-hygiene.mjs` (advisory).

**Code-quality heuristics (advisory, ratcheted)** — `g56`
`scripts/gates/line-length.mjs`, `g57` `scripts/gates/function-length.mjs`,
`g58` `scripts/gates/nesting-depth.mjs`, `g59`
`scripts/gates/magic-numbers.mjs`, `g60` `scripts/gates/ts-any-audit.mjs`,
`g61` `scripts/gates/duplication-check.mjs`, `g62`
`scripts/gates/react-a11y.mjs`, `console-error-audit`
(`scripts/gates/console-error-audit.mjs`), env-access inventory
(`scripts/gates/env-scan.mjs`), fetch-timeout heuristic
(`scripts/gates/fetch-timeout.mjs`).

**Code intelligence tools** — circular imports (`scripts/gates/circular-imports.mjs`,
blocking ratchet; the cycle count in `baselines.json` may only fall), knip
unused exports (advisory), depcheck unused dependencies (advisory),
shellcheck (advisory), osv-scanner (advisory), bundle-size budget (advisory),
pre-commit hook presence (blocking), semgrep-style Trivy misconfigurations
(advisory), Trivy license audit (advisory).

**Rust / Tauri (blocking)** — cargo-check, cargo-test, cargo-fmt,
cargo-clippy + `scripts/gates/clippy-diff.mjs` (zero new clippy debt in
changed files; legacy warnings reported as falling counts); cargo-doc,
cargo-deny, clippy-pedantic, and `cargo tree --duplicates` equivalents run as
advisory.

**Pull-request gates** — `pr-gates` (`scripts/gates/pr-gates.mjs`, blocking
title), `scripts/gates/type-safety-diff.mjs` (no new `as any` /
`@ts-ignore`), branch naming (advisory), dependency-review (advisory).

**Aggregators** — `GATEKEEPER` (all blocking gates) and
`advisory-findings-report`.

## AI-slop policy (fighting machine-generated boilerplate)

We welcome assistive tooling, but committed code must read like it was written
by a human who understands the domain. `scripts/gates/ai-slop.mjs` and
`scripts/gates/humanized-code.mjs` enforce this in strict mode:

- **Zero tolerance**: LLM self-references ("as an AI"), placeholder prose
  ("your code here", "implementation goes here"), "Generated by …" markers,
  emoji in code prose (outside string literals used as UI icons).
- **Ratcheted clichés**: marketing/filler phrases in comments — "delve into",
  "tapestry", "supercharge", "seamless integration", "leverage", "game
  changer", "it's worth noting", "in the realm of", and friends.
- **Ratcheted comment walls**: comments may not exceed 25% of a file's lines.
- **Ratcheted filler comments**: "This function…", "Please note that…",
  "In order to…" — comments must explain WHY, not narrate WHAT.
- **Ratcheted placeholder identifiers**: `foo`, `doStuff`, `data1`, `temp2`
  and their siblings are rejected in new declarations.

If a legacy occurrence trips a ratchet, fix it if you can; otherwise keep its
count at or below the baseline.

## Code integrity and CI tamper-evidence

CI-critical files (`.github/workflows/*`, `scripts/gates/**`, `CONTRIBUTING.md`,
`.editorconfig`) are pinned by SHA-256 in `.integrity/manifest.json`
(`scripts/gates/integrity-generate.mjs` regenerates the pin). The
`g29 integrity-manifest` gate recomputes every hash on every run. If you
legitimately change a CI-critical file, regenerate the manifest **in the same
commit**:

```bash
bun scripts/gates/integrity-generate.mjs
git add .integrity/manifest.json
```

Reviewed CI work may alternatively carry the `ci-change` PR label
(`g30 protected-paths`, `scripts/gates/protected-paths.mjs`). Silent workflow
tampering fails the build.

## Local gate runner

Run the whole blocking scanner suite locally before pushing (mirrors CI):

```bash
export GITHUB_EVENT_NAME=push GITHUB_SHA=$(git rev-parse HEAD)
for s in ai-slop humanized-code bug-patterns file-size secret-patterns \
         xss-patterns blank-target-safety repo-hygiene file-attrs file-naming \
         release-consistency i18n-parity tauri-config-check extension-manifest \
         dependency-budget tsconfig-strict readme-links workflow-pinning \
         docs-gate integrity-gate author-gate commit-gates semver-check \
         gitignore-check package-scripts-check; do
  bun scripts/gates/$s.mjs || exit 1
done
```

## Reporting issues

Open an issue on this fork with reproduction steps, platform, and Youwee
version. For security-sensitive reports, use "Security" → "Report a
vulnerability" instead of a public issue.
