import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Function of a hand-written CPU profile and the lines its samples hit
 */
export type ProfiledFunction = {
  functionName: string;
  url: string;

  /**
   * 0-based line of the function, as in a CPU profile
   */
  lineNumber: number;

  /**
   * Sampled line (1-based) and amount of 1 ms samples on it
   */
  samples: Array<[line: number, count: number]>;
};

/**
 * Write a Chrome trace with a CPU profile in the `ProfileChunk` events `traceCapture` records, in which every sample
 * takes 1 ms. Gzip like `traceCapture` by default, or plain json.
 *
 * @param file target file
 * @param functions profiled functions
 * @param options.gzip compress the trace. Defaults to true.
 * @param options.withLines record the line of every sample, which older Chrome versions omit. Defaults to true.
 */
export function writeTrace(file: string, functions: ProfiledFunction[], options: {gzip?: boolean; withLines?: boolean} = {}): void {
  const pid = 10;
  const tid = 11;
  const nodes = [
    {id: 1, callFrame: {codeType: 'other', functionName: '(root)', scriptId: 0}},
    {id: 2, parent: 1, callFrame: {codeType: 'other', functionName: '(program)', scriptId: 0}},
    ...functions.map((fn, index) => ({
      id: index + 3,
      parent: 1,
      callFrame: {
        codeType: 'JS', functionName: fn.functionName, url: fn.url, scriptId: index + 20, lineNumber: fn.lineNumber, columnNumber: 2,
      },
    })),
  ];
  const samples: number[] = [2];
  const lines: number[] = [0];
  for (const [index, fn] of functions.entries()) {
    for (const [line, count] of fn.samples) {
      for (let sample = 0; sample < count; sample++) {
        samples.push(index + 3);
        lines.push(line);
      }
    }
  }

  // A trailing sample of the program closes the last sample of a function
  samples.push(2);
  lines.push(0);
  const events = [
    {
      name: 'process_name', ph: 'M', pid, tid, ts: 0, cat: '__metadata', args: {name: 'Renderer'},
    },
    {
      name: 'thread_name', ph: 'M', pid, tid, ts: 0, cat: '__metadata', args: {name: 'CrRendererMain'},
    },
    {
      name: 'TracingStartedInBrowser',
      ph: 'I',
      s: 't',
      pid: 1,
      tid: 1,
      ts: 1000,
      cat: 'disabled-by-default-devtools.timeline',
      args: {
        data: {
          frameTreeNodeId: 1,
          frames: [{
            frame: 'F1', isInPrimaryMainFrame: true, isOutermostMainFrame: true, name: '', processId: pid, url: 'http://localhost:4321/',
          }],
          persistentIds: true,
        },
      },
    },
    {
      name: 'Profile', ph: 'P', id: '0x1', pid, tid, ts: 2000, cat: 'disabled-by-default-v8.cpu_profiler', args: {data: {startTime: 2000}},
    },
    {
      name: 'ProfileChunk',
      ph: 'P',
      id: '0x1',
      pid,
      tid: tid + 1,
      ts: 2001,
      cat: 'disabled-by-default-v8.cpu_profiler',
      args: {
        data: {
          cpuProfile: {nodes, samples},
          timeDeltas: samples.map((_, index) => index === 0 ? 0 : 1000),
          ...(options.withLines ?? true ? {lines} : {}),
        },
      },
    },
  ];
  const json = JSON.stringify({traceEvents: events});
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, options.gzip ?? true ? zlib.gzipSync(json) : json);
}
