import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  type CDP,
  nativeChromiumObservers,
  nativeChromiumPlugins,
} from '../../src/index.js';
import {
  defaultTraceCategories,
  screenshotTraceCategory,
} from '../../src/browsers/chromium/observers/trace-capture.js';
import {
  ChromiumCDPFixture,
} from '../fixtures/chromium-cdp.fixture.js';

type TracingCompleteHandler = (event: {stream?: string; dataLossOccurred: boolean}) => void;

describe('Trace capture observer', () => {
  let outputDir: string;
  let mockClient: ChromiumCDPFixture;
  let client: CDP.Client;

  /**
   * Emit `Tracing.tracingComplete` once tracing ended, and serve the chunks via `IO.read`
   */
  const completeWith = (chunks: Array<{data: string; base64Encoded?: boolean}>, dataLossOccurred = false) => {
    let handler: TracingCompleteHandler | undefined;
    mockClient.Tracing.tracingComplete.mockImplementation((callback: TracingCompleteHandler) => {
      handler = callback;
      return () => {
        handler = undefined;
      };
    });
    mockClient.Tracing.end.mockImplementation(async () => {
      setImmediate(() => handler?.({stream: 'stream-1', dataLossOccurred}));
      return {};
    });
    for (const [index, chunk] of chunks.entries()) {
      mockClient.IO.read.mockResolvedValueOnce({...chunk, eof: index === chunks.length - 1});
    }
  };

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-capture-'));
    mockClient = new ChromiumCDPFixture();
    client = mockClient as unknown as CDP.Client;
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  it('should start tracing with the DevTools categories as a gzip stream', async () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir});

    await observer.onStart({}, client);

    expect(observer.name).toEqual('traceCapture');
    expect(observer.plugins).toEqual([]);
    expect(mockClient.Tracing.start).toHaveBeenCalledWith({
      traceConfig: {includedCategories: defaultTraceCategories},
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      streamCompression: 'gzip',
    });
  });

  it('should add the screenshot category and custom categories', async () => {
    const observer = new nativeChromiumObservers.traceCapture({
      outputDir, categories: ['devtools.timeline'], screenshots: true, compress: false,
    });

    await observer.onStart({}, client);

    expect(mockClient.Tracing.start).toHaveBeenCalledWith(expect.objectContaining({
      traceConfig: {includedCategories: ['devtools.timeline', screenshotTraceCategory]},
      streamCompression: 'none',
    }));
  });

  it('should write the gzip stream into a file and report it', async () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir});
    const trace = zlib.gzipSync(JSON.stringify({traceEvents: [{name: 'RunTask'}]}));
    completeWith([
      {data: trace.subarray(0, 10).toString('base64'), base64Encoded: true},
      {data: trace.subarray(10).toString('base64'), base64Encoded: true},
    ]);
    const accumulator: Record<string, string | number> = {};

    await observer.onStart({}, client);
    await observer.onStop(accumulator, client);

    expect(accumulator.traceSizeBytes).toEqual(trace.length);
    expect(accumulator.traceDataLoss).toEqual(0);
    expect(String(accumulator.traceFile)).toMatch(/^.*trace-.*-1\.json\.gz$/);
    expect(path.dirname(String(accumulator.traceFile))).toEqual(outputDir);
    expect(JSON.parse(zlib.gunzipSync(fs.readFileSync(String(accumulator.traceFile))).toString())).toEqual({traceEvents: [{name: 'RunTask'}]});
    expect(mockClient.IO.read).toHaveBeenCalledTimes(2);
    expect(mockClient.IO.close).toHaveBeenCalledWith({handle: 'stream-1'});
  });

  it('should write plain json, create the folder and report data loss', async () => {
    const nestedDir = path.join(outputDir, 'nested');
    const observer = new nativeChromiumObservers.traceCapture({outputDir: nestedDir, compress: false, filePrefix: 'step'});
    completeWith([{data: '{"traceEvents":[]}'}], true);
    const accumulator: Record<string, string | number> = {};

    await observer.onStart({}, client);
    await observer.onStop(accumulator, client);

    expect(String(accumulator.traceFile)).toMatch(/step-.*\.json$/);
    expect(fs.readFileSync(String(accumulator.traceFile), 'utf8')).toEqual('{"traceEvents":[]}');
    expect(accumulator.traceDataLoss).toEqual(1);
  });

  it('should reject a second start on the same target if the trace is not stopped in time', async () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir, startTimeoutInMilliseconds: 10});

    await observer.onStart({}, client);
    await expect(observer.onStart({}, client)).rejects.toThrow('Trace already running');

    const otherClient = new ChromiumCDPFixture() as unknown as CDP.Client;
    await expect(observer.onStart({}, otherClient)).resolves.toBeUndefined();
  });

  it('should start the next trace once the previous one stopped, without waiting for its file', async () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir, compress: false});
    completeWith([{data: '{"traceEvents":[]}'}]);
    let releaseRead = () => {};
    mockClient.IO.read.mockReset().mockImplementationOnce(async () => new Promise(resolve => {
      releaseRead = () => {
        resolve({data: '{"traceEvents":[]}', eof: true});
      };
    }));
    const accumulator: Record<string, string | number> = {};

    await observer.onStart({}, client);
    // The next step starts before the previous one stopped, as Playwright doesn't await the reporter
    const nextStart = observer.onStart({}, client);
    const stop = observer.onStop(accumulator, client);

    await expect(nextStart).resolves.toBeUndefined();
    expect(mockClient.Tracing.start).toHaveBeenCalledTimes(2);
    releaseRead();
    await stop;
    expect(accumulator.traceFile).toBeDefined();
  });

  it('should fail the stop if Chrome never completes the trace', async () => {
    jest.useFakeTimers();
    try {
      const observer = new nativeChromiumObservers.traceCapture({outputDir});
      await observer.onStart({}, client);

      const stop = observer.onStop({}, client);
      const assertion = expect(stop).rejects.toThrow('Trace was not completed in time');
      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(mockClient.IO.read).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should allow a new start after a failed start', async () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir});
    mockClient.Tracing.start.mockRejectedValueOnce(new Error('Tracing is already started'));

    await expect(observer.onStart({}, client)).rejects.toThrow('TraceCaptureObserver.onStart command failed');
    await expect(observer.onStart({}, client)).resolves.toBeUndefined();
  });

  it('should do nothing on stop without a running trace, and nothing on sampling', async () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir});
    const accumulator = {};

    await observer.onSampling(accumulator, client);
    await observer.onStop(accumulator, client);

    expect(accumulator).toEqual({});
    expect(mockClient.Tracing.end).not.toHaveBeenCalled();
  });

  it('should fail the stop and release the target when reading the stream fails', async () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir});
    completeWith([]);
    mockClient.IO.read.mockRejectedValueOnce(new Error('Invalid stream handle'));
    const accumulator = {};

    await observer.onStart({}, client);
    await expect(observer.onStop(accumulator, client)).rejects.toThrow('TraceCaptureObserver.onStop command failed');

    expect(accumulator).toEqual({});
    expect(mockClient.IO.close).toHaveBeenCalledWith({handle: 'stream-1'});
    await expect(observer.onStart({}, client)).resolves.toBeUndefined();
  });

  it('should add the garbage collection plugin on request', () => {
    const observer = new nativeChromiumObservers.traceCapture({outputDir, triggerGarbageCollectionOnObserve: true});

    expect(observer.plugins).toEqual([nativeChromiumPlugins.heapGarbageCollectorPlugin]);
  });
});
