import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
  nativeChromiumPlugins,
} from '../../src/index.js';

const snapshotOf = (ids: number[], className = 'Cart') => JSON.stringify({
  snapshot: {meta: {node_fields: ['type', 'name', 'id', 'self_size'], node_types: [['object']]}},
  nodes: ids.flatMap(id => [0, 0, id, 10]),
  strings: [className],
});

describe('Memory leak observers', () => {
  describe('heapGrowth', () => {
    const clientWith = (...values: Array<Record<string, number>>) => {
      const getMetrics = jest.fn();
      for (const metrics of values) {
        getMetrics.mockResolvedValueOnce({metrics: Object.entries(metrics).map(([name, value]) => ({name, value}))});
      }

      return {Performance: {getMetrics}} as unknown as CDP.Client;
    };

    it('should report the growth between start and stop after garbage collection', async () => {
      const observer = new nativeChromiumObservers.heapGrowth();
      const client = clientWith(
        {JSHeapUsedSize: 1000, Nodes: 50, JSEventListeners: 10, Documents: 1, LayoutCount: 3},
        {JSHeapUsedSize: 5000, Nodes: 80, JSEventListeners: 9, Documents: 2},
      );
      const accumulator: Record<string, string | number> = {};

      expect(observer.plugins).toEqual([
        nativeChromiumPlugins.performanceDomainPlugin, nativeChromiumPlugins.heapProfilerDomainPlugin, nativeChromiumPlugins.heapGarbageCollectorPlugin,
      ]);
      await observer.onStart({}, client);
      await observer.onSampling({}, client);
      await observer.onStop(accumulator, client);

      expect(accumulator).toEqual(expect.objectContaining({
        heapGrowthBytes: 4000, nodeGrowth: 30, listenerGrowth: -1, documentGrowth: 1,
      }));
      expect(accumulator).not.toHaveProperty('layoutCount');
    });

    it('should report nothing without a start of the target', async () => {
      const accumulator = {};

      await new nativeChromiumObservers.heapGrowth().onStop(accumulator, clientWith({JSHeapUsedSize: 1}));

      expect(accumulator).toEqual({});
    });
  });

  describe('heapDiff', () => {
    let outputDir: string;

    beforeEach(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heap-diff-'));
    });

    afterEach(() => {
      fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const clientWith = (...snapshots: string[]) => {
      let onChunk: (event: {chunk: string}) => void = () => {};
      const takeHeapSnapshot = jest.fn();
      for (const snapshot of snapshots) {
        takeHeapSnapshot.mockImplementationOnce(async () => {
          // Chunks arrive before the command returns
          onChunk({chunk: snapshot.slice(0, 10)});
          onChunk({chunk: snapshot.slice(10)});
          return {};
        });
      }

      return {
        HeapProfiler: {
          takeHeapSnapshot,
          addHeapSnapshotChunk: jest.fn(listener => {
            onChunk = listener as typeof onChunk;
            return () => {
              onChunk = () => {};
            };
          }),
        },
      } as unknown as CDP.Client;
    };

    it('should report the classes added between start and stop and write the snapshot on request', async () => {
      const observer = new nativeChromiumObservers.heapDiff({topClasses: 5, writeSnapshots: true, outputDir: path.join(outputDir, 'heap')});
      const client = clientWith(snapshotOf([1, 2]), snapshotOf([1, 2, 3, 4]));
      const accumulator: Record<string, string | number> = {};

      await observer.onStart({}, client);
      await observer.onStop(accumulator, client);

      expect(accumulator).toEqual(expect.objectContaining({
        heapDiffAddedObjects: 2, heapDiffAddedBytes: 20, heapDiffDetachedNodes: 0, heapDiffTopClasses: JSON.stringify([{name: 'Cart', count: 2, selfSize: 20}]),
      }));
      expect(fs.readFileSync(String(accumulator.heapDiffFile), 'utf8')).toBe(snapshotOf([1, 2, 3, 4]));
    });

    it('should fail on unreadable snapshots and do nothing without a start', async () => {
      const observer = new nativeChromiumObservers.heapDiff();
      const accumulator = {};

      await observer.onStop(accumulator, clientWith());
      expect(accumulator).toEqual({});
      await expect(observer.onStart({}, clientWith('{"broken"'))).rejects.toThrow('HeapDiffObserver.onStart command failed');

      const client = clientWith(snapshotOf([1]), '{}');
      await observer.onStart({}, client);
      await expect(observer.onStop({}, client)).rejects.toThrow('HeapDiffObserver.onStop command failed');
    });
  });
});
