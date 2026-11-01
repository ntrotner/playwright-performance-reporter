import {
  execFileSync,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Leaking app of the heap tests, which writes a heap snapshot of itself
 */
export const leakyApp = path.resolve('test/fixtures/leaky-app.mjs');

/**
 * 1-based line of the leaky app that contains a text
 *
 * @param text text of the line
 */
export function leakyAppLine(text: string): number {
  return fs.readFileSync(leakyApp, 'utf8').split('\n').findIndex(line => line.includes(text)) + 1;
}

/**
 * Write a heap snapshot of the leaky app, whose records are kept by closures or by the cache itself
 *
 * @param file target `.heapsnapshot`
 * @param mode how the cache keeps the records
 */
export function writeLeakSnapshot(file: string, mode: 'closure' | 'cache' | 'keyed'): void {
  execFileSync(process.execPath, [leakyApp, file, mode]);
}
