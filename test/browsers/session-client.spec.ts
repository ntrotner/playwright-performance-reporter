import {EventEmitter} from 'node:events';
import {
  ChromiumSessionDevelopmentTools,
  createCdpSessionClient,
  createEvaluateClient,
  EvaluateDevelopmentTools,
} from '../../src/browsers/chromium/session-client.js';
import {
  Logger,
} from '../../src/helpers/index.js';
import {
  nativeChromiumObservers,
} from '../../src/index.js';

/**
 * CDP session like Playwright's, which answers commands from a map
 */
class SessionFixture extends EventEmitter {
  public send = jest.fn(async (method: string, _parameters?: Record<string, unknown>): Promise<unknown> => {
    if (method === 'Failing.command') {
      throw new Error('Target closed');
    }

    return {method};
  });
}

describe('CDP session client', () => {
  let session: SessionFixture;

  beforeEach(() => {
    session = new SessionFixture();
  });

  it('should send commands as promise or with a callback', async () => {
    const client = createCdpSessionClient(session);

    await expect(client.send('Performance.getMetrics' as any)).resolves.toEqual({method: 'Performance.getMetrics'});
    const callback = jest.fn();
    expect(client.send('Runtime.evaluate' as any, {expression: '1'}, callback)).toBeUndefined();
    client.send('Failing.command' as any, callback);
    await new Promise(setImmediate);

    expect(session.send).toHaveBeenCalledWith('Runtime.evaluate', {expression: '1'});
    expect(callback).toHaveBeenCalledWith(false, {method: 'Runtime.evaluate'});
    expect(callback).toHaveBeenCalledWith(true, new Error('Target closed'));
  });

  it('should send domain commands and subscribe to domain events', async () => {
    const client = createCdpSessionClient(session);
    const listener = jest.fn();

    await client.Profiler.setSamplingInterval({interval: 100});
    await client.Profiler.start();
    const unsubscribe = client.Network.requestWillBeSent(listener) as unknown as () => void;
    session.emit('Network.requestWillBeSent', {requestId: '1'});
    unsubscribe();
    session.emit('Network.requestWillBeSent', {requestId: '2'});

    expect(session.send).toHaveBeenCalledWith('Profiler.setSamplingInterval', {interval: 100});
    expect(session.send).toHaveBeenCalledWith('Profiler.start', undefined);
    expect(listener.mock.calls).toEqual([[{requestId: '1'}]]);
  });

  it('should subscribe with on and not look like a promise', async () => {
    const client = createCdpSessionClient(session);
    const listener = jest.fn();

    client.on('disconnect' as any, listener);
    session.emit('disconnect');

    expect(listener).toHaveBeenCalled();
    expect((client as unknown as {then?: unknown}).then).toBeUndefined();
    await expect(Promise.resolve(client)).resolves.toBe(client);
  });

  it('should measure added targets without discovering any', async () => {
    const developmentTools = new ChromiumSessionDevelopmentTools();
    session.send.mockImplementation(async () => ({metrics: [{name: 'JSHeapUsedSize', value: 10}]}));
    developmentTools.addTarget({id: 'page-1', type: 'page', url: 'about:blank'} as any, createCdpSessionClient(session));
    developmentTools.updateTarget('page-1', {url: 'https://example.com'});
    developmentTools.updateTarget('unknown', {url: 'https://unknown.com'});

    await developmentTools.connect();
    const metrics = await developmentTools.getMetric(new nativeChromiumObservers.usedJsHeapSize(), 'onStop');

    expect(metrics).toEqual([{metric: {usedJsHeapSize: 10}, id: 'page-1', type: 'page', url: 'https://example.com'}]);
  });
});

describe('Evaluate client for browsers without CDP', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should run Runtime.evaluate in the page and reject every other command', async () => {
    const evaluate = jest.fn(async (expression: string) => (expression === 'broken' ? Promise.reject(new Error('ReferenceError')) : {value: 1}));
    const client = createEvaluateClient(evaluate, 'webkit');
    const callback = jest.fn();

    client.send('Runtime.evaluate' as any, {expression: '({value: 1})', returnByValue: true}, callback);
    client.send('Runtime.evaluate' as any, {expression: 'broken'}, callback);
    client.send('Performance.getMetrics' as any, callback);
    await new Promise(setImmediate);

    expect(evaluate).toHaveBeenCalledWith('({value: 1})');
    expect(callback).toHaveBeenCalledWith(false, {result: {type: 'object', value: {value: 1}}});
    expect(callback).toHaveBeenCalledWith(false, {result: {type: 'object', subtype: 'error'}, exceptionDetails: {text: 'Error: ReferenceError'}});
    expect(callback).toHaveBeenCalledWith(true, new Error('Performance.getMetrics is not available in webkit'));
    await expect(client.Profiler.start()).rejects.toThrow('Profiler.start is not available in webkit');
    expect(typeof client.Network.requestWillBeSent(() => {})).toBe('function');
  });

  it('should run evaluate-only observers and mark the others as unsupported at their stop', async () => {
    const warning = jest.spyOn(Logger, 'warning').mockImplementation(() => {});
    const developmentTools = new EvaluateDevelopmentTools('firefox');
    developmentTools.addTarget({id: 'page-1', type: 'page', url: 'https://example.com'} as any, createEvaluateClient(async () => ({
      largestContentfulPaint: 900, firstContentfulPaint: 800, cumulativeLayoutShift: 0, interactionToNextPaint: 0,
    }), 'firefox'));
    const cpuProfiler = new nativeChromiumObservers.cpuProfiler();

    expect(developmentTools.getBrowserName()).toBe('firefox');
    expect(await developmentTools.getMetric(new nativeChromiumObservers.webVitals(), 'onStop')).toEqual([{
      id: 'page-1', type: 'page', url: 'https://example.com', metric: {largestContentfulPaint: 900, firstContentfulPaint: 800, cumulativeLayoutShift: 0, interactionToNextPaint: 0},
    }]);
    expect(await developmentTools.getMetric(cpuProfiler, 'onStart')).toEqual([]);
    expect(await developmentTools.getMetric(cpuProfiler, 'onStop')).toEqual([{id: 'page-1', type: 'page', url: 'https://example.com', metric: {unsupported: 'cpuProfiler'}}]);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('Observer "cpuProfiler" needs the Chrome DevTools Protocol and is not supported in firefox');
  });
});
