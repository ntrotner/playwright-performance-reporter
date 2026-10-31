import fs from 'node:fs';
import zlib from 'node:zlib';
import * as Trace from '@paulirish/trace_engine';
import {
  isTranspiledSource,
  stripUrl,
} from './urls.js';

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
   * Self time per line the samples hit, most first. Without line information in the trace, the line of the function.
   */
  lines: LineSelfTime[];

  /**
   * The script declares a source map (recorded with the `disabled-by-default-devtools.v8-source-rundown` category),
   * or is a transpiled source like `.ts`, so its lines are not the lines of the repository
   */
  sourceMapped?: boolean;
};

/**
 * Self time of a trace, aggregated per function across all profiled threads
 */
export type TraceSelfTime = {
  /**
   * Milliseconds of all samples except idle and the program outside of JavaScript
   */
  totalSelfTime: number;

  /**
   * Functions with a script, most self time first
   */
  functions: FunctionSelfTime[];

  /**
   * Origins of the pages in the main frame, e.g. `http://localhost:4321`. Scripts of other origins are third party.
   */
  pageOrigins: string[];
};

/**
 * Options of the self time aggregation
 */
export type TraceSelfTimeOptions = {
  /**
   * Amount of functions, most self time first. Defaults to all, so every changed line can be checked.
   */
  topFunctions?: number;

  /**
   * Amount of lines per function, most self time first. Defaults to all.
   */
  topLines?: number;
};

/**
 * Samples that are not spent in JavaScript of the page
 */
const ignoredFrames = new Set(['(idle)', '(program)', '(root)']);

/**
 * Raw event of a trace, as far as it is read here
 */
type RawEvent = {name?: string; cat?: string; args?: {data?: Record<string, unknown>}};

/**
 * Origin of an http(s) url
 *
 * @param url url
 */
function originOf(url: unknown): string | undefined {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Origins of the main frame and the scripts that declare a source map
 *
 * @param events events of the trace
 */
function scanEvents(events: RawEvent[]): {pageOrigins: Set<string>; sourceMappedUrls: Set<string>} {
  const pageOrigins = new Set<string>();
  const sourceMappedUrls = new Set<string>();
  for (const event of events) {
    const data = event.args?.data;
    if (!data) {
      continue;
    }

    if (event.name === 'TracingStartedInBrowser' && Array.isArray(data.frames)) {
      for (const frame of data.frames as Array<{url?: string; isOutermostMainFrame?: boolean; isInPrimaryMainFrame?: boolean; parent?: string}>) {
        const origin = (frame.isOutermostMainFrame ?? !frame.parent) ? originOf(frame.url) : undefined;
        if (origin) {
          pageOrigins.add(origin);
        }
      }
    } else if (event.name === 'FrameCommittedInBrowser' && !data.parent) {
      const origin = originOf(data.url);
      if (origin) {
        pageOrigins.add(origin);
      }
    } else if (event.name === 'ScriptCatchup' && event.cat === 'disabled-by-default-devtools.v8-source-rundown' && (Boolean(data.sourceMapUrl) || data.sourceMapUrlElided === true)) {
      sourceMappedUrls.add(stripUrl(typeof data.url === 'string' ? data.url : ''));
    }
  }

  return {pageOrigins, sourceMappedUrls};
}

/**
 * Read the events of a Chrome trace, gzip or plain json
 *
 * @param file trace file
 */
async function readTraceEvents(file: string): Promise<Trace.Types.Events.Event[]> {
  const buffer = await fs.promises.readFile(file);
  const isGzip = buffer.length > 2 && buffer[0] === 0x1F && buffer[1] === 0x8B;
  const json = JSON.parse((isGzip ? zlib.gunzipSync(buffer) : buffer).toString('utf8')) as unknown;
  const events = Array.isArray(json) ? json : (json as {traceEvents?: unknown}).traceEvents;
  if (!Array.isArray(events)) {
    throw new TypeError(`${file} is not a Chrome trace`);
  }

  return events as Trace.Types.Events.Event[];
}

/**
 * Self time per function and line of the CPU profile in a Chrome trace, e.g. of `traceCapture`.
 * The trace engine of the DevTools merges the profile chunks and orders the samples;
 * the self time is summed from the time between consecutive samples.
 *
 * @param file gzip or plain Chrome trace
 * @param options amount of functions and lines
 */
export async function traceSelfTime(file: string, options: TraceSelfTimeOptions = {}): Promise<TraceSelfTime> {
  const events = await readTraceEvents(file);
  const {pageOrigins, sourceMappedUrls} = scanEvents(events as RawEvent[]);
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

  const functions = new Map<string, FunctionSelfTime & {lineTimes: Map<number, number>}>();
  let totalSelfTime = 0;
  for (const threads of samplesData.profilesInProcess.values()) {
    for (const {parsedProfile: profile} of threads.values()) {
      const samples = profile.samples ?? [];
      const timestamps = profile.timestamps ?? [];
      const {lines} = (profile as {lines?: ArrayLike<number>});
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

        const key = `${node.url}|${node.functionName}|${node.lineNumber}|${node.columnNumber}`;
        const entry = functions.get(key) ?? {
          functionName: node.functionName.slice(0, 120), url: stripUrl(node.url), line: node.lineNumber + 1, column: node.columnNumber + 1, selfTime: 0, lines: [], lineTimes: new Map<number, number>(),
        };
        // Older traces have no line per sample
        const sampledLine = lines && lines[index] > 0 ? lines[index] : entry.line;
        entry.selfTime += duration;
        entry.lineTimes.set(sampledLine, (entry.lineTimes.get(sampledLine) ?? 0) + duration);
        functions.set(key, entry);
      }
    }
  }

  return {
    totalSelfTime,
    pageOrigins: [...pageOrigins],
    functions: [...functions.values()]
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, options.topFunctions)
      .map(({lineTimes, ...entry}) => ({
        ...entry,
        ...(sourceMappedUrls.has(entry.url) || isTranspiledSource(entry.url) ? {sourceMapped: true} : {}),
        lines: [...lineTimes]
          .map(([line, selfTime]) => ({line, selfTime}))
          .sort((a, b) => b.selfTime - a.selfTime)
          .slice(0, options.topLines),
      })),
  };
}
