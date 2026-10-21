import type CDP from 'chrome-remote-interface';

/**
 * Objects of a class that were added between two heap snapshots
 */
export type HeapDiffClass = {
  /**
   * Constructor name, or the node type in parentheses, e.g. `(string)`
   */
  name: string;
  count: number;

  /**
   * Bytes held by the objects themselves, without the objects they reference
   */
  selfSize: number;
};

/**
 * Objects that are in the later snapshot, but not in the earlier one
 */
export type HeapDiff = {
  addedObjects: number;
  addedBytes: number;

  /**
   * Added DOM nodes that are not part of the document anymore, a common leak
   */
  detachedNodes: number;

  /**
   * Classes with the most added bytes first
   */
  topClasses: HeapDiffClass[];
};

/**
 * Minimal shape of the `.heapsnapshot` format
 */
type HeapSnapshotJson = {
  snapshot: {
    meta: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      node_fields: string[];
      // eslint-disable-next-line @typescript-eslint/naming-convention
      node_types: [string[], ...unknown[]];
    };
  };
  nodes: number[];
  strings: string[];
};

/**
 * Node of a heap snapshot, as needed for a diff
 */
type HeapNode = {
  id: number;
  className: string;
  selfSize: number;
  detached: boolean;
};

/**
 * Value of `detachedness` for DOM nodes that are not attached to the document
 */
const detachedValue = 2;

/**
 * Types whose name is the name of the class
 */
const namedTypes = new Set(['object', 'native']);

/**
 * Parse a `.heapsnapshot` and verify its structure
 *
 * @param json heap snapshot
 */
function readSnapshot(json: string): {fields: string[]; types: string[]; nodes: number[]; strings: string[]} {
  const snapshot = JSON.parse(json) as Partial<HeapSnapshotJson>;
  const fields = snapshot.snapshot?.meta?.node_fields;
  const types = snapshot.snapshot?.meta?.node_types?.[0];
  if (!Array.isArray(fields) || !Array.isArray(types) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.strings)) {
    throw new TypeError('Invalid heap snapshot: missing meta, nodes or strings');
  }

  return {
    fields, types, nodes: snapshot.nodes, strings: snapshot.strings,
  };
}

/**
 * Parse a `.heapsnapshot` and call back for every node
 *
 * @param json heap snapshot
 * @param visit called for every node
 */
export function forEachHeapNode(json: string, visit: (node: HeapNode) => void): void {
  const {
    fields, types, nodes, strings,
  } = readSnapshot(json);
  const [typeIndex, nameIndex, idIndex, sizeIndex, detachednessIndex] = ['type', 'name', 'id', 'self_size', 'detachedness'].map(field => fields.indexOf(field));
  if (typeIndex < 0 || nameIndex < 0 || idIndex < 0 || sizeIndex < 0) {
    throw new TypeError('Invalid heap snapshot: missing node fields');
  }

  for (let offset = 0; offset < nodes.length; offset += fields.length) {
    const type = types[nodes[offset + typeIndex]] ?? 'unknown';
    if (type === 'synthetic') {
      continue;
    }

    const name = strings[nodes[offset + nameIndex]] ?? '';
    visit({
      id: nodes[offset + idIndex],
      className: namedTypes.has(type) ? name : `(${type})`,
      selfSize: nodes[offset + sizeIndex],
      detached: (detachednessIndex >= 0 && nodes[offset + detachednessIndex] === detachedValue) || name.startsWith('Detached '),
    });
  }
}

/**
 * Ids of all nodes of a heap snapshot, which are stable across snapshots of the same session
 *
 * @param json heap snapshot
 */
export function heapSnapshotIds(json: string): Set<number> {
  const ids = new Set<number>();
  forEachHeapNode(json, node => ids.add(node.id));
  return ids;
}

/**
 * Objects of a heap snapshot that were not in an earlier snapshot, grouped by class
 *
 * @param earlierIds ids of the nodes of the earlier snapshot
 * @param laterJson later heap snapshot
 * @param topClasses amount of classes to report
 */
export function diffHeapSnapshots(earlierIds: Set<number>, laterJson: string, topClasses = 20): HeapDiff {
  const classes = new Map<string, HeapDiffClass>();
  const diff: HeapDiff = {
    addedObjects: 0, addedBytes: 0, detachedNodes: 0, topClasses: [],
  };

  forEachHeapNode(laterJson, node => {
    if (earlierIds.has(node.id)) {
      return;
    }

    diff.addedObjects++;
    diff.addedBytes += node.selfSize;
    if (node.detached) {
      diff.detachedNodes++;
    }

    const heapClass = classes.get(node.className) ?? {name: node.className, count: 0, selfSize: 0};
    heapClass.count++;
    heapClass.selfSize += node.selfSize;
    classes.set(node.className, heapClass);
  });

  diff.topClasses = [...classes.values()].sort((a, b) => b.selfSize - a.selfSize || b.count - a.count).slice(0, topClasses);
  return diff;
}

/**
 * Take a heap snapshot of a target
 *
 * @param client client of the target
 * @returns the `.heapsnapshot` JSON
 */
export async function takeHeapSnapshot(client: CDP.Client): Promise<string> {
  // Chunks of concurrent snapshots of a target can't be told apart, e.g. of the stop of a step and the start of the next
  const previous = runningSnapshots.get(client) ?? Promise.resolve();
  const snapshot = (async () => {
    try {
      await previous;
    } catch {
      // A failed snapshot doesn't affect the next one
    }

    return captureHeapSnapshot(client);
  })();
  runningSnapshots.set(client, snapshot);
  return snapshot;
}

/**
 * Latest requested snapshot per target
 */
const runningSnapshots = new WeakMap<CDP.Client, Promise<string>>();

/**
 * Collect the chunks of a heap snapshot
 *
 * @param client client of the target
 */
async function captureHeapSnapshot(client: CDP.Client): Promise<string> {
  const chunks: string[] = [];
  const unsubscribe = client.HeapProfiler.addHeapSnapshotChunk(event => {
    chunks.push(event.chunk);
  });

  try {
    // Chunks are sent before the command returns
    await client.HeapProfiler.takeHeapSnapshot({reportProgress: false, captureNumericValue: false});
  } finally {
    unsubscribe();
  }

  return chunks.join('');
}
