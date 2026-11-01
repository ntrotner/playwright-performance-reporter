#!/usr/bin/env node
// Entry of `performance-attribution`. Heap snapshots of real runs need a large heap, so without one the CLI runs
// itself again with --max-old-space-size=8192, like the `attribute` and `eval` scripts.
import {
  spawnSync,
} from 'node:child_process';
import process from 'node:process';
import {
  fileURLToPath,
} from 'node:url';
import v8 from 'node:v8';

const heapMegabytes = 8192;
if (v8.getHeapStatistics().heap_size_limit < heapMegabytes * 1024 * 1024 * 0.9 && !process.env.PERFORMANCE_ATTRIBUTION_RESPAWNED) {
  const child = spawnSync(process.execPath, [...process.execArgv, `--max-old-space-size=${heapMegabytes}`, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {...process.env, PERFORMANCE_ATTRIBUTION_RESPAWNED: '1'},
  });
  process.exit(child.status ?? 1);
}

const {runCli} = await import('../lib/cli.js');
process.exitCode = await runCli(process.argv.slice(2));
