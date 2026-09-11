/**
 * Dev-only startup smoke test.
 *
 * In dev builds, proactively calls every *safe, side-effect-free* Tauri
 * command and reports any that fail. This catches the "command not
 * registered / signature drifted" bug class the moment the app starts,
 * instead of when a user opens a random dialog.
 *
 * NOT included in production bundles (guarded by `import.meta.env.DEV`).
 * Commands that spawn engines, mutate state, or open dialogs are
 * deliberately excluded.
 */
import { invoke } from '@tauri-apps/api/core';

const SAFE_COMMAND_NAMES = [
  'get_telegram_status',
  'get_history_count',
  'get_cli_shortcut_status',
  'is_flatpak_environment',
  'get_logs',
] as const;

export function runDevCommandSmoke(): void {
  void (async () => {
    const failures: string[] = [];
    for (const name of SAFE_COMMAND_NAMES) {
      try {
        await invoke(name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${name}: ${message}`);
      }
    }
    if (failures.length > 0) {
      console.warn(
        `[youwee dev-smoke] ${failures.length}/${SAFE_COMMAND_NAMES.length} startup commands failed:\n` +
          failures.join('\n'),
      );
    } else {
      console.info(
        `[youwee dev-smoke] ${SAFE_COMMAND_NAMES.length} startup commands OK ` +
          `(full static coverage: bun run check:commands)`,
      );
    }
  })();
}
