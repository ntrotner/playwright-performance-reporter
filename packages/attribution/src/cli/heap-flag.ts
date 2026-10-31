/**
 * Heap limit of the CLI, as a large `.heapsnapshot` exceeds the default heap of node.
 * `NODE_OPTIONS` can't raise the heap of a running process, so the bin re-executes node with this flag.
 */
export const heapFlag = '--max-old-space-size=8192';

/**
 * Whether the process runs without a heap limit of its own
 *
 * @param execArgv node flags of the process
 * @param nodeOptions `NODE_OPTIONS` of the process
 */
export function needsHeapFlag(execArgv: string[], nodeOptions = ''): boolean {
  return !execArgv.some(flag => flag.startsWith('--max-old-space-size')) && !nodeOptions.includes('--max-old-space-size');
}

/**
 * Arguments of node to re-execute the script with the raised heap
 *
 * @param execArgv node flags of the process
 * @param script path of the script
 * @param argv arguments of the script
 */
export function reexecArguments(execArgv: string[], script: string, argv: string[]): string[] {
  return [heapFlag, ...execArgv, script, ...argv];
}
