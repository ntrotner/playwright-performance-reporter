import fs from 'node:fs';
import zlib from 'node:zlib';
import * as Trace from '@paulirish/trace_engine';
import {
  stripUrl,
} from './hunks.js';

/**
 * Self time of a line within a function
 */
export type LineSelfTime = {
  /**
   * 1-based line the samples hit
   */
  line: number;
  selfTime: number;
};

/**
 * Self time of a function, i.e. the time it was on top of the stack
 */
export type FunctionSelfTime = {
  functionName: string;

  /**
   * Url of the script, without query and fragment
   */
  url: string;

  /**
   * 1-based line and column of the function
   */
  line: number;
  column: number;

  /**
   * Milliseconds
   */
  selfTime: number;

  /**
   * Self time per line the samples hit, most first. Without line ticks in the trace, the line of the function.
   */
  lines: LineSelfTime[];
};

/**
 * Self time of a trace, aggregated per function across all profiled threads
 */
export type TraceSelfTime = {
  /**
   * Milliseconds of all samples except idle, the program outside of JavaScript, and garbage collection
   */
  totalSelfTime: number;

  /**
   * Functions with a script, most self time first
   */
  functions: FunctionSelfTime[];
};

/**
 * Options of the self time aggregation
 */
export type TraceSelfTimeOptions = {
  /**
   * Amount of functions, most self time first. Defaults to 25.
   */
  topFunctions?: number;

  /**
   * Amount of lines per function, most self time first. Defaults to 5.
   */
  topLines?: number;
};

/**
 * Samples that are not spent in JavaScript of the page
 */
const ignoredFrames = new Set(['(idle)', '(program)', '(root)', '(garbage collector)']);

/**
 * Milliseconds rounded to microseconds, so sums don't carry floating point noise
 *
 * @param value milliseconds
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Read the events of a Chrome trace, gzip (magic bytes `1f 8b`) or plain json, as an array or `{traceEvents}`
 *
 * @param file trace file
 */
export async function readTraceEvents(file: string): Promise<Trace.Types.Events.Event[]> {
  const buffer = await fs.promises.readFile(file);
  const isGzip = buffer.length > 2 && buffer[0] === 0x1F && buffer[1] === 0x8B;
  const json = JSON.parse((isGzip ? zlib.gunzipSync(buffer) : buffer).toString('utf8')) as unknown;
  const events = Array.isArray(json) ? json : (json as {traceEvents?: unknown} | undefined)?.traceEvents;
  if (!Array.isArray(events)) {
    throw new TypeError(`${file} is not a Chrome trace`);
  }

  return events as Trace.Types.Events.Event[];
}

/**
 * Self time per function and line of the CPU profile in a Chrome trace, e.g. of `traceCapture`. The trace engine of
 * the DevTools merges the profile chunks and orders the samples; the self time of a sample is the time until the next.
 * Only names, urls, positions and times leave this function, never the events.
 *
 * @param file gzip or plain Chrome trace
 * @param options amount of functions and lines
 */
export async function traceSelfTime(file: string, options: TraceSelfTimeOptions = {}): Promise<TraceSelfTime> {
  const events = await readTraceEvents(file);
  const model = Trace.TraceModel.Model.createWithSubsetOfHandlers({
    /* eslint-disable @typescript-eslint/naming-convention */
    Meta: Trace.Handlers.ModelHandlers.Meta,
    Samples: Trace.Handlers.ModelHandlers.Samples,
    /* eslint-enable @typescript-eslint/naming-convention */
  });
  await model.parse(events);
  const samplesData = model.parsedTrace()?.data.Samples;
  if (!samplesData) {
    throw new Error(`${file} has no CPU profile`);
  }

  const functions = new Map<string, Omit<FunctionSelfTime, 'lines'> & {lineTimes: Map<number, number>}>();
  let totalSelfTime = 0;
  for (const threads of samplesData.profilesInProcess.values()) {
    for (const {parsedProfile: profile} of threads.values()) {
      const samples = profile.samples ?? [];
      const timestamps = profile.timestamps ?? [];
      const {lines} = profile as {lines?: ArrayLike<number>};
      for (let index = 0; index < samples.length - 1; index++) {
        const node = profile.nodeById(samples[index]);
        const duration = timestamps[index + 1] - timestamps[index];
        if (!node || ignoredFrames.has(node.functionName) || !(duration > 0)) {
          continue;
        }

        totalSelfTime += duration;
        if (!node.url) {
          continue;
        }

        const url = stripUrl(node.url);
        const key = `${url}|${node.functionName}|${node.lineNumber}|${node.columnNumber}`;
        const entry = functions.get(key) ?? {
          functionName: node.functionName.slice(0, 120), url, line: node.lineNumber + 1, column: node.columnNumber + 1, selfTime: 0, lineTimes: new Map<number, number>(),
        };
        const sampledLine = lines && lines[index] > 0 ? lines[index] : entry.line;
        entry.selfTime += duration;
        entry.lineTimes.set(sampledLine, (entry.lineTimes.get(sampledLine) ?? 0) + duration);
        functions.set(key, entry);
      }
    }
  }

  return {
    totalSelfTime: round(totalSelfTime),
    functions: [...functions.values()]
      .map(({lineTimes, ...entry}) => ({
        ...entry,
        selfTime: round(entry.selfTime),
        lines: [...lineTimes]
          .map(([line, selfTime]) => ({line, selfTime: round(selfTime)}))
          .sort((a, b) => b.selfTime - a.selfTime || a.line - b.line)
          .slice(0, options.topLines ?? 5),
      }))
      .sort((a, b) => b.selfTime - a.selfTime || a.url.localeCompare(b.url) || a.line - b.line || a.column - b.column || a.functionName.localeCompare(b.functionName))
      .slice(0, options.topFunctions ?? 25),
  };
}
