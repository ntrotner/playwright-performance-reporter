import type CDP from 'chrome-remote-interface';
import {
  diffHeapSnapshots,
  forEachHeapNode,
  heapSnapshotIds,
  takeHeapSnapshot,
} from '../../src/helpers/index.js';

type Node = [type: number, name: number, id: number, selfSize: number, detachedness: number];

const types = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic'];
const strings = ['', 'Cart', 'HTMLDivElement', 'Detached HTMLSpanElement', 'onclick', 'Window'];

/**
 * Snapshot in the format of Chromium, with the fields of the nodes flattened into one list
 */
const snapshot = (nodes: Node[], fields = ['type', 'name', 'id', 'self_size', 'detachedness']) => JSON.stringify({
  snapshot: {meta: {node_fields: fields, node_types: [types, 'string', 'number']}},
  nodes: nodes.flat(),
  strings,
});

const before = snapshot([
  [9, 0, 1, 0, 0],
  [3, 5, 3, 100, 0],
  [3, 1, 5, 40, 0],
]);
const after = snapshot([
  [9, 0, 1, 0, 0],
  [3, 5, 3, 100, 0],
  [3, 1, 5, 40, 0],
  [3, 1, 7, 40, 0],
  [3, 1, 9, 40, 0],
  [8, 2, 11, 120, 2],
  [8, 3, 13, 80, 0],
  [2, 0, 15, 16, 0],
  [5, 4, 17, 32, 0],
]);

describe('Heap snapshot helpers', () => {
  it('should read the nodes and skip synthetic ones', () => {
    const nodes: unknown[] = [];
    forEachHeapNode(before, node => nodes.push(node));

    expect(nodes).toEqual([
      {id: 3, className: 'Window', selfSize: 100, detached: false},
      {id: 5, className: 'Cart', selfSize: 40, detached: false},
    ]);
    expect(heapSnapshotIds(before)).toEqual(new Set([3, 5]));
  });

  it('should group the added objects by class and count detached DOM nodes', () => {
    expect(diffHeapSnapshots(heapSnapshotIds(before), after, 3)).toEqual({
      addedObjects: 6,
      addedBytes: 328,
      detachedNodes: 2,
      topClasses: [
        {name: 'HTMLDivElement', count: 1, selfSize: 120},
        {name: 'Cart', count: 2, selfSize: 80},
        {name: 'Detached HTMLSpanElement', count: 1, selfSize: 80},
      ],
    });
  });

  it('should support snapshots without detachedness and name closures and strings by type', () => {
    const old = snapshot([[2, 0, 1, 16, 0], [5, 4, 2, 32, 0]].map(node => node.slice(0, 4)) as unknown as Node[], ['type', 'name', 'id', 'self_size']);

    expect(diffHeapSnapshots(new Set(), old).topClasses).toEqual([
      {name: '(closure)', count: 1, selfSize: 32},
      {name: '(string)', count: 1, selfSize: 16},
    ]);
  });

  it.each([
    ['not json', 'not json', SyntaxError],
    ['missing meta', JSON.stringify({nodes: [], strings: []}), 'missing meta'],
    ['missing fields', JSON.stringify({snapshot: {meta: {node_fields: ['type'], node_types: [types]}}, nodes: [], strings: []}), 'missing node fields'],
  ])('should reject %s', (_, json, error) => {
    expect(() => heapSnapshotIds(json)).toThrow(error as string);
  });

  it('should take concurrent snapshots of a target one after another, as their chunks share one event', async () => {
    const listeners = new Set<(event: {chunk: string}) => void>();
    let call = 0;
    const client = {
      HeapProfiler: {
        addHeapSnapshotChunk: jest.fn(listener => {
          listeners.add(listener as (event: {chunk: string}) => void);
          return () => listeners.delete(listener as (event: {chunk: string}) => void);
        }),
        takeHeapSnapshot: jest.fn(async () => {
          call++;
          const name = call === 1 ? 'first' : 'second';
          for (const listener of listeners) {
            listener({chunk: `${name}-a|`});
          }

          await new Promise(setImmediate);
          for (const listener of listeners) {
            listener({chunk: `${name}-b`});
          }

          if (call === 1) {
            throw new Error('Target closed');
          }

          return {};
        }),
      },
    } as unknown as CDP.Client;

    const [first, second] = await Promise.allSettled([takeHeapSnapshot(client), takeHeapSnapshot(client)]);

    expect(first.status).toBe('rejected');
    expect(second).toEqual({status: 'fulfilled', value: 'second-a|second-b'});
  });
});
