import {
  analysis,
  config,
  ErrorHandling,
  type IHeapEdge,
  type IHeapNode,
  type IHeapSnapshot,
  utils,
} from '@memlab/core';
import {
  stripUrl,
} from './urls.js';

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
 * Function on the retainer path of an object, whose closure keeps the object alive
 */
export type HeapFrame = {
  functionName: string;
  url: string;

  /**
   * 1-based line and column of the function
   */
  line: number;
  column: number;

  /**
   * Fewest edges between the sampled object and the closure, 0 if the object is the closure itself
   */
  distance: number;

  /**
   * Amount of sampled objects whose retainer path contains the closure
   */
  hits: number;

  /**
   * The script declares a source map, so its lines are not the lines of the repository
   */
  sourceMapped?: boolean;
};

/**
 * Variable of a function or module scope on the retainer path of an object, e.g. the module variable `cache` that
 * holds the array that holds the object. The scope is a frame of the path: its context belongs to a script, so the
 * changed line that fills or declares the variable can be looked up in that script.
 */
export type HeapVariable = {
  name: string;

  /**
   * Script of the scope
   */
  url: string;

  /**
   * Fewest edges between the sampled object and the variable
   */
  distance: number;

  /**
   * Amount of sampled objects whose retainer path contains the variable
   */
  hits: number;
  sourceMapped?: boolean;
};

/**
 * Growth of a class and what retains its objects
 */
export type ClassGrowth = HeapDiffClass & {
  /**
   * Amount of objects of the class whose retainer path was followed, the newest ones of the snapshot
   */
  sampled: number;

  /**
   * Most common retainer path from the object towards the GC root, as `type:name <-[edge]` steps
   */
  retainerPath: string[];

  /**
   * Closures on the sampled retainer paths, closest to the object first
   */
  frames: HeapFrame[];

  /**
   * Scope variables on the sampled retainer paths, closest to the object first
   */
  variables: HeapVariable[];
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
const ignoredClasses = new Set(['(hidden)', '(code)', '(object shape)', '(system)', '(compiled code)', '(number)']);

/**
 * Steps of the retainer path shown per class
 */
const shownPathSteps = 12;

/**
 * Parse `heapDiffTopClasses`, a JSON string of `heapDiff`
 *
 * @param topClasses recorded classes
 */
export function parseTopClasses(topClasses: string | undefined): HeapDiffClass[] {
  if (!topClasses) {
    return [];
  }

  try {
    const parsed = JSON.parse(topClasses) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is HeapDiffClass => typeof entry?.name === 'string' && typeof entry?.selfSize === 'number')
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
 * Script of a function and whether it declares a source map
 */
type ScriptInfo = {url: string; sourceMapped: boolean};

/**
 * Marker of a source map at the end of a script
 */
const sourceMapPattern = /[#@]\s*sourceMappingURL\s*=/;

/**
 * Value of a string node, or undefined for other nodes
 *
 * @param node heap node
 */
function stringValueOf(node: IHeapNode | undefined): string | undefined {
  return node?.type.includes('string') ? node.toStringNode()?.stringValue : undefined;
}

/**
 * Script of a function: closure -> shared function info -> script -> name and source. The source is only checked
 * for a source map marker, it never leaves this function.
 *
 * @param closure closure node
 * @param cache scripts by node id
 */
function scriptOf(closure: IHeapNode, cache: Map<number, ScriptInfo>): ScriptInfo {
  const shared = closure.getReferenceNode('shared');
  const script = shared?.getReferenceNode('script') ?? shared?.getReferenceNode('script_or_debug_info');
  if (!script) {
    return {url: '', sourceMapped: false};
  }

  let info = cache.get(script.id);
  if (!info) {
    const url = stringValueOf(script.getReferenceNode('name') ?? undefined) ?? script.name ?? '';
    const source = stringValueOf(script.getReferenceNode('source') ?? undefined) ?? '';
    info = {url: stripUrl(url), sourceMapped: sourceMapPattern.test(source.slice(-1000))};
    cache.set(script.id, info);
  }

  return info;
}

/**
 * Script of the scope a context belongs to, from a function that uses the context
 *
 * @param context context node
 * @param scripts scripts by node id
 */
function scriptOfContext(context: IHeapNode, scripts: Map<number, ScriptInfo>): ScriptInfo | undefined {
  const closure = context.referrers.find(edge => edge.fromNode.type === 'closure' && String(edge.name_or_index) === 'context')?.fromNode;
  return closure ? scriptOf(closure, scripts) : undefined;
}

/**
 * Edge names that are part of the engine, not of the code
 */
const internalNames = /^(?:__proto__|constructor|prototype|map|elements|properties|table)$|^[^\w$]|\s/;

/**
 * Types whose name is the content of the object, e.g. the characters of a string, and never leaves the snapshot
 */
const contentTypes = new Set(['string', 'concatenated string', 'sliced string', 'number', 'bigint']);

/**
 * Name of a node that is safe to show: never the content of a string, and only the tag of a DOM node,
 * whose name can contain attribute values
 *
 * @param node heap node
 */
export function describeNode(node: IHeapNode): string {
  if (contentTypes.has(node.type)) {
    return node.type;
  }

  const tag = /^<([\w-]+)/.exec(node.name)?.[1];
  const name = tag ? `<${tag}>` : node.name.slice(0, 80);
  return `${node.type}:${name || '(anonymous)'}`;
}

/**
 * Follow the shortest retainer path of an object towards the GC root
 *
 * @param node sampled object
 * @param maxPathLength maximum edges
 */
function retainerPath(node: IHeapNode, maxPathLength: number): Array<{node: IHeapNode; edge?: string; edgeType?: string; retainer?: IHeapNode}> {
  const path: Array<{node: IHeapNode; edge?: string; edgeType?: string; retainer?: IHeapNode}> = [];
  let current: IHeapNode | undefined = node;
  while (current && path.length <= maxPathLength) {
    const edge: IHeapEdge | undefined = current.pathEdge ?? undefined;
    path.push({
      node: current, edge: edge ? String(edge.name_or_index) : undefined, edgeType: edge?.type, retainer: edge?.fromNode,
    });
    current = edge?.fromNode;
  }

  return path;
}

/**
 * Scope variable the retainer of a step holds the step by. Properties are left out: an object can come from any
 * script, so a property name says nothing about which changed line created it.
 *
 * @param step step of a retainer path
 * @param step.edge name of the edge from the retainer
 * @param step.edgeType type of that edge
 * @param step.retainer node that holds the step
 * @param scripts scripts by node id
 */
function describeVariable(step: {edge?: string; edgeType?: string; retainer?: IHeapNode}, scripts: Map<number, ScriptInfo>): Omit<HeapVariable, 'distance' | 'hits'> | undefined {
  if (!step.edge || !step.retainer || internalNames.test(step.edge) || /^\d+$/.test(step.edge)) {
    return undefined;
  }

  // Variables of a scope are context edges of its context
  if (step.edgeType !== 'context' || step.retainer.name !== 'system / Context') {
    return undefined;
  }

  const script = scriptOfContext(step.retainer, scripts);
  return script?.url ? {name: step.edge.slice(0, 80), url: script.url, ...(script.sourceMapped ? {sourceMapped: true} : {})} : undefined;
}

/**
 * Class growth of a heap snapshot of `heapDiff`, with the retainer paths and the closures that retain the grown
 * classes. Only this snapshot is loaded; the growth itself comes from `heapDiffTopClasses`. Nothing of the snapshot
 * is returned but class names, sizes, edge names and source locations.
 *
 * @param file `.heapsnapshot` of the stop of the test or step
 * @param topClasses classes recorded by `heapDiff`
 * @param options amount of classes and samples
 */
export async function heapGrowth(file: string, topClasses: HeapDiffClass[], options: HeapGrowthOptions = {}): Promise<HeapGrowth> {
  const classes = topClasses
    .filter(entry => !ignoredClasses.has(entry.name))
    .sort((a, b) => b.selfSize - a.selfSize)
    .slice(0, options.topClasses ?? 8);
  if (classes.length === 0) {
    return {classes: []};
  }

  config.muteConsole = true;
  // Memlab exits the process on a broken snapshot unless told to throw
  config.errorHandling = ErrorHandling.Throw;
  const heap = await utils.getSnapshotFromFile(file, {buildNodeIdIndex: true});
  if (!heap) {
    throw new Error(`${file} is not a heap snapshot`);
  }

  analysis.preparePathFinder(heap);
  const locations = indexLocations(heap);
  const scripts = new Map<number, ScriptInfo>();

  // Newest objects have the highest ids, so they are most likely added during the step
  const samplesPerClass = options.samplesPerClass ?? 20;
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

  return {
    classes: classes.map(entry => {
      const sampled = candidates.get(entry.name)!.sort((a, b) => b.id - a.id).slice(0, samplesPerClass);
      const frames = new Map<string, HeapFrame>();
      const variables = new Map<string, HeapVariable>();
      const paths = new Map<string, {count: number; steps: string[]}>();
      for (const node of sampled) {
        const steps = retainerPath(node, options.maxPathLength ?? 40);
        const seen = new Set<string>();
        for (const [distance, step] of steps.entries()) {
          const variable = describeVariable(step, scripts);
          if (variable) {
            const key = `variable|${variable.url}|${variable.name}`;
            const entry = variables.get(key) ?? {...variable, distance, hits: 0};
            entry.distance = Math.min(entry.distance, distance);
            if (!seen.has(key)) {
              entry.hits++;
              seen.add(key);
            }

            variables.set(key, entry);
          }

          const location = step.node.type === 'closure' ? locations.get(step.node.nodeIndex) : undefined;
          if (!location) {
            continue;
          }

          const {url, sourceMapped} = scriptOf(step.node, scripts);
          const key = `${url}|${location.line}|${location.column}`;
          const frame = frames.get(key) ?? {
            functionName: step.node.name.slice(0, 80), url, line: location.line, column: location.column, distance, hits: 0, ...(sourceMapped ? {sourceMapped} : {}),
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
        paths.set(signature, {count: (paths.get(signature)?.count ?? 0) + 1, steps: described});
      }

      return {
        ...entry,
        sampled: sampled.length,
        retainerPath: [...paths.values()].sort((a, b) => b.count - a.count)[0]?.steps ?? [],
        frames: [...frames.values()].sort((a, b) => a.distance - b.distance || b.hits - a.hits),
        variables: [...variables.values()].sort((a, b) => a.distance - b.distance || b.hits - a.hits).slice(0, 12),
      };
    }),
  };
}
