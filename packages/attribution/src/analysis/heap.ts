import {
  analysis,
  config,
  ErrorHandling,
  type IHeapEdge,
  type IHeapNode,
  type IHeapSnapshot,
  NumericSet,
  TraceFinder,
  utils,
} from '@memlab/core';
import {
  getDominatorNodes,
} from '@memlab/heap-analysis';
import {
  stripUrl,
} from './hunks.js';

/**
 * Objects of a class that were added during a test or step, as `heapDiff` records them in `heapDiffTopClasses`
 */
export type HeapDiffClass = {
  /**
   * Constructor name, or the node type in parentheses, e.g. `(closure)`
   */
  name: string;
  count: number;
  selfSize: number;
};

/**
 * Closure on the retainer path of an object, which keeps the object alive
 */
export type HeapFrame = {
  functionName: string;

  /**
   * Url of the script of the function, without query and fragment
   */
  url: string;

  /**
   * 1-based line and column of the function
   */
  line: number;
  column: number;

  /**
   * Fewest edges between a sampled object and the closure: the lower, the deeper the frame
   */
  distance: number;

  /**
   * Amount of sampled objects whose retainer path contains the closure
   */
  hits: number;
};

/**
 * Growth of a class and what retains its objects
 */
export type ClassGrowth = HeapDiffClass & {
  /**
   * Amount of objects of the class whose retainer path was followed, the newest ones that no other sampled object
   * dominates
   */
  sampled: number;

  /**
   * Most common retainer path from the object towards the GC root, as `type:name <-[edge]` steps
   */
  retainerPath: string[];

  /**
   * Most common immediate dominator of the sampled objects, i.e. the object whose release frees them
   */
  dominator?: string;

  /**
   * Closures on the retainer paths of the sampled objects, deepest (closest to the object) first
   */
  frames: HeapFrame[];
};

/**
 * Class growth of a test or step with the retainers of the grown classes
 */
export type HeapGrowth = {
  classes: ClassGrowth[];
};

/**
 * Options of the heap analysis
 */
export type HeapGrowthOptions = {
  /**
   * Amount of classes to follow, most added bytes first. Defaults to 8.
   */
  topClasses?: number;

  /**
   * Objects per class whose retainer path is followed. Defaults to 20.
   */
  samplesPerClass?: number;

  /**
   * Maximum edges of a retainer path. Defaults to 40.
   */
  maxPathLength?: number;
};

/**
 * Engine internals that say nothing about the code of the page
 */
const ignoredClasses = new Set(['(hidden)', '(code)', '(object shape)', '(system)', '(compiled code)', '(number)', '(string)', '(concatenated string)', '(sliced string)']);

/**
 * Steps of the retainer path shown per class
 */
const shownPathSteps = 12;

/**
 * Types whose name is the content of the object, which never leaves the snapshot
 */
const contentTypes = new Set(['string', 'concatenated string', 'sliced string', 'number', 'bigint']);

/**
 * Parse `heapDiffTopClasses`, the JSON string `heapDiff` records
 *
 * @param topClasses recorded classes
 */
export function parseTopClasses(topClasses: string | undefined): HeapDiffClass[] {
  try {
    const parsed = JSON.parse(topClasses ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is HeapDiffClass => typeof entry?.name === 'string' && typeof entry?.selfSize === 'number' && typeof entry?.count === 'number')
      : [];
  } catch {
    return [];
  }
}

/**
 * Whether a node belongs to a class of `heapDiffTopClasses`
 *
 * @param node heap node
 * @param className class name of `heapDiff`
 */
function belongsTo(node: IHeapNode, className: string): boolean {
  const typeName = /^\((.+)\)$/.exec(className)?.[1];
  if (typeName) {
    return node.type === typeName;
  }

  return node.name === className && (node.type === 'object' || node.type === 'native');
}

/**
 * Source location of every function, by node index. memlab's `node.location` misreads the `object_index`
 * of Chrome snapshots, which is an offset into the nodes array, so the raw locations are indexed here.
 *
 * @param heap parsed snapshot
 */
function indexLocations(heap: IHeapSnapshot): Map<number, {line: number; column: number}> {
  const raw = heap.snapshot;
  const nodeFieldCount = raw.snapshot.meta.node_fields.length;
  const fields = raw.snapshot.meta.location_fields ?? [];
  const objectIndex = fields.indexOf('object_index');
  const lineIndex = fields.indexOf('line');
  const columnIndex = fields.indexOf('column');
  const locations = new Map<number, {line: number; column: number}>();
  if (objectIndex === -1 || lineIndex === -1 || fields.length === 0) {
    return locations;
  }

  for (let offset = 0; offset + fields.length <= (raw.locations?.length ?? 0); offset += fields.length) {
    locations.set(raw.locations[offset + objectIndex] / nodeFieldCount, {line: raw.locations[offset + lineIndex] + 1, column: raw.locations[offset + columnIndex] + 1});
  }

  return locations;
}

/**
 * Url of the script of a function: closure -> shared function info -> script -> name
 *
 * @param closure closure node
 * @param cache urls by script node id
 */
function scriptUrlOf(closure: IHeapNode, cache: Map<number, string>): string {
  const shared = closure.getReferenceNode('shared');
  const script = shared?.getReferenceNode('script') ?? shared?.getReferenceNode('script_or_debug_info');
  if (!script) {
    return '';
  }

  let url = cache.get(script.id);
  if (url === undefined) {
    const name = script.getReferenceNode('name');
    url = stripUrl((name?.type.includes('string') ? name.toStringNode()?.stringValue : undefined) ?? '');
    cache.set(script.id, url);
  }

  return url;
}

/**
 * Name of a node that is safe to show: never the content of a string, and only the tag of a DOM node,
 * whose name can contain attribute values
 *
 * @param node heap node
 */
function describeNode(node: IHeapNode): string {
  if (contentTypes.has(node.type)) {
    return node.type;
  }

  const tag = /^<([\w-]+)/.exec(node.name)?.[1];
  const name = tag ? `<${tag}>` : node.name.slice(0, 80);
  return `${node.type}:${name || '(anonymous)'}`;
}

/**
 * Edge names that are safe to show: identifiers like variable and property names, and element indices. Other keys,
 * e.g. of a map filled from page data, can carry tokens or payloads.
 */
const safeEdgeName = /^(?:[A-Za-z_$][\w$]{0,40}|\d+)$/;

/**
 * Name of an edge that is safe to show
 *
 * @param name name or index of the edge
 */
function describeEdge(name: string | number): string {
  const text = String(name);
  return safeEdgeName.test(text) ? text : '<key>';
}

/**
 * Shortest retainer path of an object towards the GC root
 *
 * @param node sampled object
 * @param maxPathLength maximum edges
 */
function retainerPath(node: IHeapNode, maxPathLength: number): Array<{node: IHeapNode; edge?: string}> {
  const steps: Array<{node: IHeapNode; edge?: string}> = [];
  let current: IHeapNode | undefined = node;
  while (current && steps.length <= maxPathLength) {
    const edge: IHeapEdge | undefined = current.pathEdge ?? undefined;
    steps.push({node: current, edge: edge ? describeEdge(edge.name_or_index) : undefined});
    current = edge?.fromNode;
  }

  return steps;
}

/**
 * Most common value of a list, the first one on a tie
 *
 * @param values values
 */
function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Load a heap snapshot with memlab, with shortest retainer paths and dominators
 *
 * @param file `.heapsnapshot`
 */
async function loadSnapshot(file: string): Promise<IHeapSnapshot> {
  config.muteConsole = true;
  // Memlab exits the process on a broken snapshot unless told to throw
  config.errorHandling = ErrorHandling.Throw;
  const heap = await utils.getSnapshotFromFile(file, {buildNodeIdIndex: true});
  if (!heap?.nodes?.length) {
    throw new Error(`${file} is not a heap snapshot`);
  }

  analysis.preparePathFinder(heap);
  new TraceFinder().calculateAllNodesRetainedSizes(heap);
  return heap;
}

/**
 * Class growth of a heap snapshot of `heapDiff`, with the retainer paths, dominators and the closures that retain the
 * grown classes. Only this snapshot is loaded; the growth itself comes from `heapDiffTopClasses`. Nothing of the
 * snapshot leaves this function but class names, sizes, edge names and source locations.
 *
 * @param file `.heapsnapshot` of the stop of the test or step
 * @param topClasses classes recorded by `heapDiff`
 * @param options amount of classes and samples
 */
export async function heapGrowth(file: string, topClasses: HeapDiffClass[], options: HeapGrowthOptions = {}): Promise<HeapGrowth> {
  const classes = topClasses
    .filter(entry => !ignoredClasses.has(entry.name))
    .sort((a, b) => b.selfSize - a.selfSize || a.name.localeCompare(b.name))
    .slice(0, options.topClasses ?? 8);
  const heap = await loadSnapshot(file);
  if (classes.length === 0) {
    return {classes: []};
  }

  const locations = indexLocations(heap);
  const scripts = new Map<number, string>();
  const candidates = new Map<string, IHeapNode[]>(classes.map(entry => [entry.name, []]));
  // A pseudo array of millions of nodes, which is not iterable
  for (let index = 0; index < heap.nodes.length; index++) {
    const node = heap.nodes.get(index);
    if (!node?.hasPathEdge) {
      continue;
    }

    for (const entry of classes) {
      if (belongsTo(node, entry.name)) {
        candidates.get(entry.name)!.push(node);
      }
    }
  }

  const samplesPerClass = options.samplesPerClass ?? 20;
  return {
    classes: classes.map(entry => {
      // Newest objects have the highest ids, so they were most likely added during the step
      const newest = candidates.get(entry.name)!.sort((a, b) => b.id - a.id).slice(0, samplesPerClass * 4);
      const ids = new NumericSet();
      for (const node of newest) {
        ids.add(node.id);
      }

      const independent = getDominatorNodes(ids, heap);
      const sampled = newest.filter(node => independent.has(node.id)).slice(0, samplesPerClass);
      const frames = new Map<string, HeapFrame>();
      const paths: string[] = [];
      const signatures = new Map<string, string[]>();
      for (const node of sampled) {
        const steps = retainerPath(node, options.maxPathLength ?? 40);
        const seen = new Set<string>();
        for (const [distance, step] of steps.entries()) {
          const location = step.node.type === 'closure' ? locations.get(step.node.nodeIndex) : undefined;
          if (!location) {
            continue;
          }

          const url = scriptUrlOf(step.node, scripts);
          const key = `${url}|${location.line}|${location.column}`;
          const frame = frames.get(key) ?? {
            functionName: step.node.name.slice(0, 80), url, line: location.line, column: location.column, distance, hits: 0,
          };
          frame.distance = Math.min(frame.distance, distance);
          if (!seen.has(key)) {
            frame.hits++;
            seen.add(key);
          }

          frames.set(key, frame);
        }

        const described = steps.slice(0, shownPathSteps).map(step => `${describeNode(step.node)}${step.edge === undefined ? '' : ` <-[${step.edge}]`}`);
        const signature = described.join(' | ');
        signatures.set(signature, described);
        paths.push(signature);
      }

      const dominator = mostCommon(sampled.map(node => node.dominatorNode).filter(node => node !== null && node !== undefined).map(node => describeNode(node)));
      return {
        ...entry,
        sampled: sampled.length,
        retainerPath: signatures.get(mostCommon(paths) ?? '') ?? [],
        ...(dominator ? {dominator} : {}),
        frames: [...frames.values()].sort((a, b) => a.distance - b.distance || b.hits - a.hits || a.url.localeCompare(b.url) || a.line - b.line),
      };
    }),
  };
}
