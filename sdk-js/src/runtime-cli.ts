import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPluginModule } from './runtime';
import type { PluginDefinition } from './types';

const STRIP_RUNTIME_ENV_KEYS = [
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_LIBRARY_PATH',
  'LD_LIBRARY_PATH',
] as const;

// Native (untranspiled) dynamic import. tsc compiles this file to CommonJS
// (module: CommonJS in sdk-js/tsconfig.json), which rewrites a literal
// `import(specifier)` into a require()-based helper that cannot load ESM
// plugin bundles (.mjs). Evaluating this one-line wrapper keeps the real
// import() in the emitted dist/runtime-cli.js.
//
// Static analyzers flag the construct as eval-like (CodeQL js/eval-like-call).
// It is not an interpreter sink:
// the only caller, loadPluginModule() below, resolves the entrypoint from
// argv[2] / YOUWEE_PLUGIN_MAIN to an absolute local path, restricts it to
// .mjs/.mts/.ts files, verifies the path exists as a regular file, and
// converts it to a file:// URL before this wrapper runs. The trust boundary
// is therefore the process owner's own file system - the same trust level as
// running node itself. require(esm) cannot replace it because the supported
// engine floor is Node 18 (require of ESM needs Node 20.19+).
// lgtm[js/eval-like-call]
const nativeDynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

function sanitizeRuntimeEnvironment(): void {
  for (const key of STRIP_RUNTIME_ENV_KEYS) {
    try {
      delete process.env[key];
    } catch {
      // Ignore environment mutation failures and continue.
    }
  }

  const denoEnv = (
    globalThis as typeof globalThis & {
      Deno?: {
        env?: {
          delete?: (key: string) => void;
        };
      };
    }
  ).Deno?.env;

  if (!denoEnv?.delete) {
    return;
  }

  for (const key of STRIP_RUNTIME_ENV_KEYS) {
    try {
      denoEnv.delete(key);
    } catch {
      // Ignore environment mutation failures and continue.
    }
  }
}

async function loadPluginModule(): Promise<PluginDefinition | { default?: PluginDefinition }> {
  const pluginMain = process.argv[2] || process.env.YOUWEE_PLUGIN_MAIN;

  if (!pluginMain) {
    throw new Error(
      'Plugin entrypoint is not set. Pass it as the first argument or set YOUWEE_PLUGIN_MAIN.',
    );
  }

  const resolvedPluginMain = resolve(pluginMain);
  if (/\.(mjs|mts|ts)$/i.test(resolvedPluginMain)) {
    // The ESM branch bypasses require() resolution, so make a missing or
    // non-regular entrypoint fail with a clear message instead of a raw
    // module-not-found stack trace.
    if (!statSync(resolvedPluginMain, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Plugin entrypoint is not a file: ${resolvedPluginMain}`);
    }

    return (await nativeDynamicImport(pathToFileURL(resolvedPluginMain).href)) as
      | PluginDefinition
      | { default?: PluginDefinition };
  }

  return require(resolvedPluginMain) as PluginDefinition | { default?: PluginDefinition };
}

async function main(): Promise<void> {
  sanitizeRuntimeEnvironment();
  const plugin = await loadPluginModule();
  await runPluginModule(plugin);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
