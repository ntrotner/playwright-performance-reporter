import vm from 'node:vm';
import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
} from '../../src/index.js';
import {
  metricUnit,
} from '../../src/presenters/comparison-presenter/constants.js';
import {
  type ResourceTimingResult,
} from '../../src/browsers/chromium/observers/resource-timing.js';
import {
  type Metric,
} from '../../src/types/index.js';
import {
  ChromiumCDPFixture,
} from '../fixtures/chromium-cdp.fixture.js';

const resourceEntry = (overrides: Record<string, unknown> = {}) => ({
  name: 'https://example.com/app.js',
  initiatorType: 'script',
  nextHopProtocol: 'h2',
  startTime: 100,
  fetchStart: 105,
  redirectStart: 0,
  redirectEnd: 0,
  domainLookupStart: 105,
  domainLookupEnd: 115,
  connectStart: 115,
  connectEnd: 145,
  secureConnectionStart: 125,
  requestStart: 150,
  responseStart: 205,
  responseEnd: 255,
  transferSize: 1300,
  encodedBodySize: 1000,
  decodedBodySize: 4000,
  ...overrides,
});

const hiddenEntry = resourceEntry({
  name: 'https://cdn.example.org/font.woff2',
  nextHopProtocol: '',
  domainLookupStart: 0,
  domainLookupEnd: 0,
  connectStart: 0,
  connectEnd: 0,
  secureConnectionStart: 0,
  requestStart: 0,
  responseStart: 0,
  transferSize: 0,
  encodedBodySize: 0,
  decodedBodySize: 0,
});

const cachedEntry = resourceEntry({
  name: 'https://example.com/style.css',
  initiatorType: 'link',
  transferSize: 0,
});

describe('Resource timing observer', () => {
  let mockClient: ChromiumCDPFixture;
  let client: CDP.Client;

  /**
   * Answer Runtime.evaluate by running the expression against a fake performance API
   */
  const evaluateWith = (entries: Array<Record<string, unknown>>, setResourceTimingBufferSize = jest.fn()) => {
    mockClient.send.mockImplementation((_command: string, parameters: {expression: string}, callback: (error: boolean, response: unknown) => void) => {
      const value: unknown = vm.runInNewContext(parameters.expression, {
        performance: {setResourceTimingBufferSize, getEntriesByType: () => entries},
      });
      callback(false, {result: {type: 'object', value: structuredClone(value)}});
    });
  };

  beforeEach(() => {
    mockClient = new ChromiumCDPFixture();
    client = mockClient as unknown as CDP.Client;
  });

  it('should only evaluate in the page without enabling any domain', async () => {
    const observer = new nativeChromiumObservers.resourceTiming();
    evaluateWith([]);

    await observer.onStart({}, client);
    await observer.onSampling({}, client);
    await observer.onStop({}, client);

    expect(observer.plugins).toEqual([]);
    expect(mockClient.send.mock.calls.map(call => call[0] as string)).toEqual(['Runtime.evaluate', 'Runtime.evaluate', 'Runtime.evaluate']);
    expect(mockClient.send.mock.calls[0][1]).toEqual(expect.objectContaining({returnByValue: true}));
  });

  it('should break down the phases of each resource and aggregate them', async () => {
    const observer = new nativeChromiumObservers.resourceTiming();
    const accumulator: Metric = {};
    evaluateWith([resourceEntry(), hiddenEntry, cachedEntry]);

    await observer.onStop(accumulator, client);

    const {resourceTimings, ...aggregates} = accumulator as unknown as ResourceTimingResult;
    expect(resourceTimings).toHaveLength(3);
    expect(resourceTimings[0]).toEqual({
      name: 'https://example.com/app.js',
      initiatorType: 'script',
      nextHopProtocol: 'h2',
      transferSize: 1300,
      encodedBodySize: 1000,
      decodedBodySize: 4000,
      dnsTime: 10,
      tcpTime: 30,
      tlsTime: 20,
      requestTime: 55,
      responseTime: 50,
      redirectTime: 0,
      blockedTime: 5,
      cached: false,
      timingHidden: false,
    });
    expect(resourceTimings[1]).toEqual(expect.objectContaining({
      nextHopProtocol: '', dnsTime: 0, tcpTime: 0, tlsTime: 0, requestTime: 0, responseTime: 0, cached: false, timingHidden: true,
    }));
    expect(resourceTimings[2]).toEqual(expect.objectContaining({cached: true, timingHidden: false}));
    expect(aggregates).toEqual({
      totalResources: 3,
      totalTransferSize: 1300,
      totalEncodedBodySize: 2000,
      totalDecodedBodySize: 8000,
      totalDnsTime: 20,
      totalTcpTime: 60,
      totalTlsTime: 40,
      totalRequestTime: 110,
      totalResponseTime: 100,
      totalRedirectTime: 0,
      totalBlockedTime: 15,
      cacheHits: 1,
      timingHiddenResources: 1,
    });
  });

  it('should omit the details when includeDetails is false', async () => {
    const observer = new nativeChromiumObservers.resourceTiming({includeDetails: false});
    const accumulator: Metric = {};
    evaluateWith([resourceEntry()]);

    await observer.onSampling(accumulator, client);

    expect(accumulator).not.toHaveProperty('resourceTimings');
    expect(accumulator.totalResources).toEqual(1);
  });

  it('should write zero aggregates for an empty buffer', async () => {
    const observer = new nativeChromiumObservers.resourceTiming();
    const accumulator: Metric = {};
    evaluateWith([]);

    await observer.onStop(accumulator, client);

    const {resourceTimings, ...aggregates} = accumulator as unknown as ResourceTimingResult;
    expect(resourceTimings).toEqual([]);
    expect(Object.values(aggregates).every(value => value === 0)).toBe(true);
  });

  it('should increase the buffer size of the page', async () => {
    const setResourceTimingBufferSize = jest.fn();
    evaluateWith([], setResourceTimingBufferSize);

    await new nativeChromiumObservers.resourceTiming().onStop({}, client);
    await new nativeChromiumObservers.resourceTiming({bufferSize: 1000}).onStop({}, client);
    await new nativeChromiumObservers.resourceTiming({bufferSize: Number.NaN}).onStop({}, client);

    expect(setResourceTimingBufferSize.mock.calls).toEqual([[500], [1000], [500]]);
  });

  it.each([
    ['an error', true, {result: {type: 'object', value: {totalResources: 1}}}],
    ['a non-object result', false, {result: {type: 'undefined'}}],
    ['a null result', false, {result: {type: 'object', subtype: 'null', value: null}}],
    ['no response', false, undefined],
  ])('should leave the accumulator unchanged on %s', async (_, error, response) => {
    const observer = new nativeChromiumObservers.resourceTiming();
    const accumulator: Metric = {existing: 1};
    mockClient.send.mockImplementation((_command: string, _parameters: unknown, callback: (error: boolean, response: unknown) => void) => {
      callback(error, response);
    });

    await observer.onStop(accumulator, client);

    expect(accumulator).toEqual({existing: 1});
  });

  it('should report the phase totals in milliseconds', () => {
    for (const metric of ['totalDnsTime', 'totalTcpTime', 'totalTlsTime', 'totalRequestTime', 'totalResponseTime', 'totalRedirectTime', 'totalBlockedTime']) {
      expect(metricUnit(metric)).toEqual('ms');
    }

    expect(metricUnit('totalTransferSize')).toEqual('bytes');
  });
});
