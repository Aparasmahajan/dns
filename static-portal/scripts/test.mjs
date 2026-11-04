// Bundles tests/api.test.ts with esbuild (already installed with Vite) and runs it in Node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'static-portal-test-'));
const out = join(dir, 'api.test.mjs');
try {
  await build({ entryPoints: [join(root, 'tests', 'api.test.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  const run = spawnSync(process.execPath, [out], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
