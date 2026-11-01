import fs from 'node:fs';
import path from 'node:path';
import {
  heapGrowth,
  parseTopClasses,
} from '../../src/analysis/heap.js';
import {
  temporaryDirectory,
} from '../helpers.js';
import {
  leakyApp,
  leakyAppLine,
  writeLeakSnapshot,
} from '../fixtures/heap.js';

/**
 * Classes `heapDiff` records for the leak, as its JSON string
 */
const topClasses = JSON.stringify([
  {name: '(code)', count: 10, selfSize: 900_000},
  {name: 'LeakedRecord', count: 2000, selfSize: 40_000},
]);

describe('heap growth', () => {
  const dir = temporaryDirectory('attribution-heap-');
  const closureSnapshot = path.join(dir, 'closure.heapsnapshot');
  const cacheSnapshot = path.join(dir, 'cache.heapsnapshot');

  beforeAll(() => {
    writeLeakSnapshot(closureSnapshot, 'closure');
    writeLeakSnapshot(cacheSnapshot, 'cache');
  });

  it('parses the top classes of heapDiff and skips what is no list of classes', () => {
    expect(parseTopClasses(topClasses).map(entry => entry.name)).toEqual(['(code)', 'LeakedRecord']);
    expect([parseTopClasses(undefined), parseTopClasses('{'), parseTopClasses('{"name":"x"}')]).toEqual([[], [], []]);
  });

  it('follows the retainer path of a grown class to the closure that keeps its objects', async () => {
    const growth = await heapGrowth(closureSnapshot, parseTopClasses(topClasses), {samplesPerClass: 10});

    // Engine internals like (code) are skipped
    expect(growth.classes.map(entry => [entry.name, entry.sampled])).toEqual([['LeakedRecord', 10]]);
    expect(growth.classes[0].retainerPath.slice(0, 3).map(step => step.replace(/ <-\[.*]$/, ''))).toEqual(['object:LeakedRecord', 'object:system / Context', 'closure:(anonymous)']);
    expect(growth.classes[0].frames[0]).toMatchObject({
      url: `file://${leakyApp}`, line: leakyAppLine('cache.push(() => record.payload[0]);'), hits: 10,
    });
  });

  it('reports the module functions on the path of a cache, but no closure of its own', async () => {
    const growth = await heapGrowth(cacheSnapshot, parseTopClasses(topClasses), {samplesPerClass: 10});

    expect(growth.classes[0].retainerPath.slice(0, 2).map(step => step.replace(/ <-\[.*]$/, ''))).toEqual(['object:LeakedRecord', 'object:Array']);
    expect(growth.classes[0].frames.map(frame => frame.line)).not.toContain(leakyAppLine('cache.push(record);'));
  });

  it('never returns the content of the snapshot', async () => {
    const growth = await heapGrowth(closureSnapshot, parseTopClasses(topClasses), {samplesPerClass: 10});

    expect(JSON.stringify(growth)).not.toContain('secret-heap-token');
  });

  it('replaces edge names that are no identifier or index, as keys can carry page data', async () => {
    const file = path.join(dir, 'keyed.heapsnapshot');
    writeLeakSnapshot(file, 'keyed');

    const growth = await heapGrowth(file, parseTopClasses(topClasses), {samplesPerClass: 10});

    expect(growth.classes[0].retainerPath[0]).toBe('object:LeakedRecord <-[<key>]');
    expect(JSON.stringify(growth)).not.toContain('secret-heap-key');
  });

  it('rejects a file that is no heap snapshot', async () => {
    const file = path.join(dir, 'broken.heapsnapshot');
    fs.writeFileSync(file, '{"snapshot": {}}');

    await expect(heapGrowth(file, parseTopClasses(topClasses))).rejects.toThrow();
  });
});
