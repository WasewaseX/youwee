#!/usr/bin/env node
/**
 * Tauri command consistency smoke check.
 *
 * Catches at CI time the exact bug class that shipped twice in this fork:
 *   1. A frontend `invoke('some_command')` with no matching entry in the
 *      `invoke_handler!` list in src-tauri/src/lib.rs — fails silently at
 *      runtime ("it randomly stopped working").
 *   2. A `#[tauri::command]` defined in Rust but never registered — dead code
 *      that will fail the moment the frontend starts calling it.
 *
 * Usage: node scripts/check-tauri-commands.mjs
 * Exit code 0 = consistent, 1 = drift detected.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

// --- 1. Registered commands from invoke_handler! ---
const libRs = readFileSync(join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8');
const handlerStart = libRs.indexOf('generate_handler![');
if (handlerStart === -1) {
  console.error('FATAL: generate_handler![ not found in src-tauri/src/lib.rs');
  process.exit(1);
}
const handlerBlock = libRs.slice(handlerStart, libRs.indexOf('])', handlerStart));
const registered = new Set();
for (const m of handlerBlock.matchAll(/commands::(\w+)/g)) registered.add(m[1]);
for (const m of handlerBlock.matchAll(/^\s{12}(\w+),/gm)) registered.add(m[1]);

// --- 2. #[tauri::command] definitions across Rust modules ---
const rustFiles = walk(join(repoRoot, 'src-tauri/src'), ['.rs']);
const defined = new Set();
const definedIn = new Map();
for (const f of rustFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(
    /#\[tauri::command\]\s*(?:pub(?:\s\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)/g,
  )) {
    defined.add(m[1]);
    if (!definedIn.has(m[1])) definedIn.set(m[1], relative(repoRoot, f));
  }
}

// --- 3. Frontend invoke('...') literals ---
const tsFiles = walk(join(repoRoot, 'src'), ['.ts', '.tsx']);
const called = new Set();
const calledIn = new Map();
// Dynamic template-literal calls: invoke<T>(`prefix_${expr}`) — the exact
// command name is built at runtime, so the static PREFIX is checked against
// the registered command family instead (e.g. `rollback_${engine}` requires
// at least one rollback_* command in invoke_handler!).
const dynamicPrefixes = [];
for (const f of tsFiles) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(repoRoot, f);
  for (const m of src.matchAll(
    /\binvoke(?:First|AndIgnore)?(?:<[^>]*>)?\s*\(\s*['"`](\w+)['"`]/g,
  )) {
    // Skip dynamic invocation via string concatenation (`invoke('x_' + id)`)
    // — cannot be verified statically; not a drift signal.
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^\s*\+/.test(tail)) continue;
    called.add(m[1]);
    if (!calledIn.has(m[1])) calledIn.set(m[1], rel);
  }
  for (const m of src.matchAll(/\binvoke(?:First|AndIgnore)?(?:<[^>]*>)?\s*\(\s*`([^`\\]*)`/g)) {
    const tpl = m[1];
    const interpolation = tpl.indexOf('${');
    // A template literal without interpolation is a plain string — already
    // matched by the quoted-literal pass above.
    if (interpolation === -1) continue;
    const prefix = tpl.slice(0, interpolation);
    // Only a non-empty word-char prefix is statically checkable.
    if (!prefix || !/^\w+$/.test(prefix)) continue;
    dynamicPrefixes.push({ prefix, at: rel });
  }
}

let failed = false;

// Frontend calls with no registered command -> guaranteed runtime failure.
for (const cmd of [...called].sort()) {
  if (!registered.has(cmd)) {
    failed = true;
    console.error(`✗ invoke('${cmd}') at ${calledIn.get(cmd)} — NOT registered in invoke_handler!`);
  }
}

// Defined but never registered -> silent failure waiting to happen.
for (const cmd of [...defined].sort()) {
  if (!registered.has(cmd)) {
    failed = true;
    console.error(
      `✗ #[tauri::command] '${cmd}' (${definedIn.get(cmd)}) — defined but missing from invoke_handler!`,
    );
  }
}

// Dynamic template-literal families (`prefix_${expr}`) must resolve to at
// least one registered command, otherwise the whole family is dead drift.
const dynamicSorted = [...dynamicPrefixes].sort((a, b) =>
  a.prefix === b.prefix ? a.at.localeCompare(b.at) : a.prefix.localeCompare(b.prefix),
);
for (const { prefix, at } of dynamicSorted) {
  const family = [...registered].filter((c) => c.startsWith(prefix)).sort();
  if (family.length === 0) {
    failed = true;
    console.error(
      `✗ dynamic invoke(\`${prefix}_\${…}\`) at ${at} — no registered command starts with '${prefix}'`,
    );
  }
}

// Informational: registered but never invoked (kept as a warning list only).
const uncalled = [...registered].filter((c) => !called.has(c)).sort();

console.log(`Registered commands: ${registered.size}`);
console.log(`#[tauri::command] definitions: ${defined.size}`);
console.log(`Frontend invoke() literals: ${called.size}`);
console.log(`Dynamic invoke() template-literal prefixes: ${dynamicPrefixes.length}`);
for (const { prefix, at } of dynamicSorted) {
  const family = [...registered].filter((c) => c.startsWith(prefix)).sort();
  console.log(`  - ${prefix}* → ${family.join(', ')} (${at})`);
}
console.log(`Registered but never invoked from TS (informational): ${uncalled.length}`);

if (failed) {
  console.error('\nTauri command drift detected — fix the mismatches above.');
  process.exit(1);
}
console.log('\n✓ All frontend invoke() calls resolve to registered Tauri commands.');
