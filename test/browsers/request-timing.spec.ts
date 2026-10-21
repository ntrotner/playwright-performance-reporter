import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
} from '../../src/index.js';
import {
  registerRequestSource,
} from '../../src/browsers/chromium/observers/request-timing.js';
import {
  ChromiumSessionDevelopmentTools,
  createRecordingClient,
  playwrightTargetType,
} from '../../src/browsers/chromium/session-client.js';
import {
  classifyMetric,
  metricUnit,
} from '../../src/presenters/comparison-presenter/constants.js';
import {
  type RecordedRequest,
} from '../../src/fixture/request-recorder.js';

const request = (url: string, duration: number, extra: Partial<RecordedRequest> = {}): RecordedRequest => ({
  url, method: 'GET', status: 200, resourceType: 'fetch', startTime: 0, duration, failed: false, api: false, ...extra,
});

describe('Request timing observer', () => {
  it('should summarize the requests since the start of the step', async () => {
    const observer = new nativeChromiumObservers.requestTiming({endpoints: [{name: 'search', pattern: '*/api/search*'}], topSlowest: 2});
    const client = {} as CDP.Client;
    const source = {requests: [request('https://shop.com/before', 9000)]};
    registerRequestSource(client, source);
    const start: Record<string, string | number> = {};
    const stop: Record<string, string | number> = {};

    await observer.onStart(start, client);
    source.requests.push(
      request('https://shop.com/api/search?q=a', 100, {timeToFirstByte: 40}),
      request('https://shop.com/api/search?q=b', 300, {timeToFirstByte: 80}),
      request('https://api.shop.com/users', 200, {api: true, resourceType: 'api'}),
      request('https://shop.com/blocked', 0, {failed: true, status: 0}),
    );
    await observer.onStop(stop, client);

    expect(observer.capabilities).toEqual(['playwright']);
    expect(start).toEqual(expect.objectContaining({requestCount: 0, requestDurationP95: 0, slowestRequests: '[]'}));
    expect(stop).toEqual({
      requestCount: 4,
      requestFailedCount: 1,
      requestDurationP50: 200,
      requestDurationP95: 290,
      requestDurationMax: 300,
      requestTtfbP95: 78,
      apiRequestCount: 1,
      apiRequestDurationP95: 200,
      'requestDuration:search': 290,
      slowestRequests: JSON.stringify([
        {url: 'https://shop.com/api/search?q=b', method: 'GET', status: 200, resourceType: 'fetch', duration: 300},
        {url: 'https://api.shop.com/users', method: 'GET', status: 200, resourceType: 'api', duration: 200},
      ]),
    });
  });

  it('should leave out unknown values and do nothing without recorded requests', async () => {
    const observer = new nativeChromiumObservers.requestTiming();
    const client = {} as CDP.Client;
    registerRequestSource(client, {requests: [request('https://shop.com', 50)]});
    const accumulator: Record<string, string | number> = {};
    const unknown = {};

    await observer.onSampling(accumulator, client);
    await observer.onStop(unknown, {} as CDP.Client);

    expect(accumulator).not.toHaveProperty('requestTtfbP95');
    expect(accumulator.requestCount).toBe(1);
    expect(unknown).toEqual({});
  });

  it('should fail the commands of the recording target without unhandled rejections', async () => {
    const client = createRecordingClient();
    const callback = jest.fn();

    client.send('IO.close' as any, callback);
    await expect(client.send('Runtime.evaluate' as any)).rejects.toThrow('Runtime.evaluate is not available, the recording target has no page');
    expect(callback).toHaveBeenCalledWith(true, expect.any(Error));
  });

  it('should run observers of Playwright recordings only on the recording target', async () => {
    const developmentTools = new ChromiumSessionDevelopmentTools();
    const recordingClient = createRecordingClient();
    registerRequestSource(recordingClient, {requests: [request('https://shop.com', 50)]});
    developmentTools.addTarget({id: 'playwright', type: playwrightTargetType, url: ''} as CDP.Target, recordingClient);
    const pageClient = {
      send(_method: string, _parameters: unknown, callback: (error: boolean, response: unknown) => void) {
        callback(false, {result: {type: 'object', value: {largestContentfulPaint: 1, firstContentfulPaint: 1, cumulativeLayoutShift: 0, interactionToNextPaint: 0}}});
      },
    } as unknown as CDP.Client;
    developmentTools.addTarget({id: 'page-1', type: 'page', url: 'https://shop.com'} as CDP.Target, pageClient);

    const requests = await developmentTools.getMetric(new nativeChromiumObservers.requestTiming(), 'onStop');
    const vitals = await developmentTools.getMetric(new nativeChromiumObservers.webVitals(), 'onStop');

    expect(requests.map(target => target.id)).toEqual(['playwright']);
    expect(vitals.map(target => target.id)).toEqual(['page-1']);
  });

  it.each([
    ['requestDurationP95', 'total', 'ms'],
    ['requestDuration:search', 'total', 'ms'],
    ['requestTtfbP95', 'total', 'ms'],
    ['apiRequestDurationP95', 'total', 'ms'],
    ['requestCount', 'cumulative', 'count'],
  ])('should classify %s as %s in %s', (metric, kind, unit) => {
    expect(classifyMetric(metric)).toBe(kind);
    expect(metricUnit(metric)).toBe(unit);
  });
});
