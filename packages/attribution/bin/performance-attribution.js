#!/usr/bin/env node
import {
  spawnSync,
} from 'node:child_process';
import process from 'node:process';
import {
  fileURLToPath,
} from 'node:url';
import {
  needsHeapFlag,
  reexecArguments,
} from '../lib/cli/heap-flag.js';

// A large .heapsnapshot needs more than the default heap, which only a flag of node itself can raise
if (needsHeapFlag(process.execArgv, process.env.NODE_OPTIONS)) {
  const child = spawnSync(process.execPath, reexecArguments(process.execArgv, fileURLToPath(import.meta.url), process.argv.slice(2)), {stdio: 'inherit'});
  process.exit(child.status ?? 1);
}

const {main} = await import('../lib/cli/main.js');
// Exit right away, even if an aborted model call still holds a socket
process.exit(await main(process.argv.slice(2)));
