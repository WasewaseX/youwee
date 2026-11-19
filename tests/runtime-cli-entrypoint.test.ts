import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Regression test for the ESM entrypoint validation in
// sdk-js/src/runtime-cli.ts. Needs sdk-js/dist to exist: run
// `bun run build:sdk` first (the CI gate does this before `bun test`).

describe('runtime-cli plugin entrypoint validation', () => {
  test('reports a missing ESM plugin entrypoint as a file error', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'youwee-sdk-runtime-cli-missing-'));
    const runtimeCli = resolve(process.cwd(), 'sdk-js/dist/runtime-cli.js');

    const { exitCode, stdout, stderr } = await new Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }>((resolvePromise, reject) => {
      const proc = spawn(process.execPath, [runtimeCli, join(tempDir, 'does-not-exist.mjs')], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', reject);
      proc.on('close', (code) => {
        resolvePromise({ exitCode: code, stdout, stderr });
      });
      proc.stdin.end();
    });

    rmSync(tempDir, { recursive: true, force: true });

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Plugin entrypoint is not a file');
  });
});
