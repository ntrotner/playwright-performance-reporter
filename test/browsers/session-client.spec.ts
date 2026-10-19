import {EventEmitter} from 'node:events';
import {
  ChromiumSessionDevelopmentTools,
  createCdpSessionClient,
} from '../../src/browsers/chromium/session-client.js';
import {
  resolveConditions,
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

  it('should throttle pages with the conditions', async () => {
    const developmentTools = new ChromiumSessionDevelopmentTools(resolveConditions({cpuSlowdown: 4}));

    await developmentTools.throttlePage(createCdpSessionClient(session), 'https://example.com');
    await new ChromiumSessionDevelopmentTools().throttlePage(createCdpSessionClient(session), 'https://example.com');

    expect(session.send.mock.calls).toEqual([['Emulation.setCPUThrottlingRate', {rate: 4}]]);
  });
});
