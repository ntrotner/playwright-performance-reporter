import {
  type CDP,
  nativeChromiumObservers,
} from '../../src/index.js';
import {
  classifyMetric,
  metricUnit,
} from '../../src/presenters/comparison-presenter/constants.js';
import {
  ChromiumCDPFixture,
} from '../fixtures/chromium-cdp.fixture.js';

const navigationTiming = {
  timeToFirstByte: 212.4,
  redirectTime: 0,
  dnsLookupTime: 8.2,
  tcpConnectTime: 24.6,
  tlsTime: 51.9,
  requestTime: 98.1,
  responseTime: 29.7,
  domContentLoadedTime: 412,
  domCompleteTime: 531.5,
  loadEventTime: 540.2,
  nextHopProtocol: 'h2',
  navigationTransferSize: 18_423,
  navigationEncodedBodySize: 17_311,
  navigationDecodedBodySize: 64_210,
};

describe('Navigation timing observer', () => {
  let mockClient: ChromiumCDPFixture;
  let client: CDP.Client;
  let executedCommands: string[];
  let expressions: string[];

  const respondWith = (error: unknown, response: unknown) => {
    mockClient.send.mockImplementation((command: string, parameters: {expression: string}, callback: (error: unknown, response: unknown) => void) => {
      executedCommands.push(command);
      expressions.push(parameters.expression);
      callback(error, response);
    });
  };

  beforeEach(() => {
    mockClient = new ChromiumCDPFixture();
    client = mockClient as unknown as CDP.Client;
    executedCommands = [];
    expressions = [];
  });

  it('should write the navigation timing into the accumulator', async () => {
    respondWith(undefined, {result: {type: 'object', value: {...navigationTiming}}});
    const observer = new nativeChromiumObservers.navigationTiming();
    const accumulator = {};

    await observer.onStop(accumulator, client);

    expect(observer.plugins).toEqual([]);
    expect(executedCommands).toEqual(['Runtime.evaluate']);
    expect(accumulator).toEqual(navigationTiming);
  });

  it('should read the same snapshot on start and sampling', async () => {
    respondWith(undefined, {result: {type: 'object', value: {...navigationTiming}}});
    const observer = new nativeChromiumObservers.navigationTiming();
    const startAccumulator = {};
    const samplingAccumulator = {};

    await observer.onStart(startAccumulator, client);
    await observer.onSampling(samplingAccumulator, client);

    expect(startAccumulator).toEqual(navigationTiming);
    expect(samplingAccumulator).toEqual(navigationTiming);
  });

  it('should compute the phases from the navigation entry', async () => {
    respondWith(undefined, {result: {type: 'object', value: {}}});

    await new nativeChromiumObservers.navigationTiming().onStop({}, client);

    expect(expressions[0]).toContain('performance.getEntriesByType(\'navigation\')');
    for (const formula of [
      'timeToFirstByte: entry.responseStart - entry.startTime',
      'redirectTime: entry.redirectEnd - entry.redirectStart',
      'dnsLookupTime: entry.domainLookupEnd - entry.domainLookupStart',
      'tcpConnectTime: entry.connectEnd - entry.connectStart',
      'tlsTime: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0',
      'requestTime: entry.responseStart - entry.requestStart',
      'responseTime: entry.responseEnd - entry.responseStart',
      'domContentLoadedTime: entry.domContentLoadedEventEnd - entry.startTime',
      'domCompleteTime: entry.domComplete - entry.startTime',
      'loadEventTime: entry.loadEventEnd - entry.startTime',
    ]) {
      expect(expressions[0]).toContain(formula);
    }
  });

  it('should omit sizes and load milestones if disabled', async () => {
    respondWith(undefined, {result: {type: 'object', value: {...navigationTiming}}});
    const observer = new nativeChromiumObservers.navigationTiming({includeSizes: false, includeLoadMilestones: false});
    const accumulator = {};

    await observer.onStop(accumulator, client);

    expect(Object.keys(accumulator)).toEqual([
      'timeToFirstByte',
      'redirectTime',
      'dnsLookupTime',
      'tcpConnectTime',
      'tlsTime',
      'requestTime',
      'responseTime',
    ]);
  });

  it.each([
    ['a missing navigation entry', undefined, {result: {type: 'object', subtype: 'null', value: null}}],
    ['an evaluation error', new Error('evaluation failed'), undefined],
    ['a non-object result', undefined, {result: {type: 'undefined'}}],
  ])('should leave the accumulator unchanged on %s', async (_, error, response) => {
    respondWith(error, response);
    const accumulator = {existing: 1};

    await new nativeChromiumObservers.navigationTiming().onStop(accumulator, client);

    expect(accumulator).toEqual({existing: 1});
  });

  it('should compare the latest navigation timing in milliseconds', () => {
    expect(classifyMetric('timeToFirstByte')).toEqual('total');
    expect(metricUnit('timeToFirstByte')).toEqual('ms');
    expect(metricUnit('dnsLookupTime')).toEqual('ms');
    expect(metricUnit('loadEventTime')).toEqual('ms');
    expect(metricUnit('navigationTransferSize')).toEqual('bytes');
  });
});
