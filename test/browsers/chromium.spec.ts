import {ChromiumDevelopmentTools} from '../../src/browsers/chromium/index.js';
import {
  AllPerformanceMetrics,
  TotalJsHeapSize,
  UsedJsHeapSize,
  HeapDump,
} from '../../src/browsers/chromium/observers/index.js';
import {
  type ChromiumSupportedMetrics,
  type OnStartMeasure,
} from '../../src/types/index.js';
import {ChromiumCDPFixture} from '../fixtures/chromium-cdp.fixture.js';
import {LockFixture} from '../fixtures/index.js';

const customObserver: OnStartMeasure = async (accumulator, client) => new Promise(resolve => {
  client.send('Custom.Protocol.Command' as any, (error, response) => {
    if (!error) {
      Object.assign(accumulator, response);
    }

    resolve();
  });
},
);

describe('Chromium client', () => {
  let chromiumDevelopmentTools: ChromiumDevelopmentTools;
  let mockClient: ChromiumCDPFixture;
  let options: Record<string, any>;

  beforeEach(() => {
    options = {
      launchOptions: {
        args: [
          '--remote-debugging-port=9222',
        ],
      },
    };
    chromiumDevelopmentTools = new ChromiumDevelopmentTools(options);
    mockClient = new ChromiumCDPFixture();
    // Disable connect function as it's environment specific and I don't care mocking the CDP client
    chromiumDevelopmentTools.connect = jest.fn();
    (chromiumDevelopmentTools as any).connectLock = new LockFixture();
    (chromiumDevelopmentTools as any).clients = {'mockClient': mockClient};
  });

  it('should give the correct browser name', () => {
    expect(chromiumDevelopmentTools.getBrowserName()).toEqual('chromium');
  });

  it('should return an empty list if metric is unsupported', async () => {
    const response = await chromiumDevelopmentTools.getMetric('unrelated' as ChromiumSupportedMetrics, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(response).toEqual([]);
  });

  it('should shortly remain in the waiting stage due to connect lock', async () => {
    (chromiumDevelopmentTools as any).connectLock.isLocked = jest.fn().mockReturnValue(true);
    const response = await chromiumDevelopmentTools.getMetric('unrelated' as ChromiumSupportedMetrics, 'onStart');

    expect((chromiumDevelopmentTools as any).connectLock.notifyOnUnlock).toHaveBeenCalled();
    expect((chromiumDevelopmentTools as any).connect).not.toHaveBeenCalled();
    expect(response).toEqual([]);
  });

  it('should not activate Performance domain if client is not ready', async () => {
    (chromiumDevelopmentTools as any).clients = {};
    const response = await (chromiumDevelopmentTools as any).startPerformance('mockClient');

    expect(response).toBe(false);
  });

  it('should activate Performance domain if client is ready', async () => {
    mockClient.send.mockImplementation((command, callback) => callback(true));
    const response = await (chromiumDevelopmentTools as any).startPerformance('mockClient');

    expect(response).toBe(true);
  });

  it('should not activate HeapProfiler domain if client is not ready', async () => {
    (chromiumDevelopmentTools as any).clients = {};
    const response = await (chromiumDevelopmentTools as any).startHeapProfiler('mockClient');

    expect(response).toBe(false);
  });

  it('should activate HeapProfiler domain if client is ready', async () => {
    mockClient.send.mockImplementation((command, callback) => callback(true));
    const response = await (chromiumDevelopmentTools as any).startHeapProfiler('mockClient');

    expect(response).toBe(true);
  });

  it('should skip domain activation when client is not ready', async () => {
    (chromiumDevelopmentTools as any).clients = {};
    await (chromiumDevelopmentTools as any).activateDomain('someId', {name: 'totalJsHeapSize'});
  });

  it('should activate the Performance domain and return the requested metric for UsedJsHeapSize', async () => {
    const testObserver = new UsedJsHeapSize();
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(false);
      } else if (command === 'Performance.getMetrics') {
        callback(false, {metrics: [{name: testObserver.chromiumCompatibleName, value: 123}]});
      }
    });
    const responseStop = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStop');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[0]).toEqual('Performance.enable');
    expect(executedCommands[1]).toEqual('Performance.getMetrics');
    expect(responseStop).toEqual([{metric: {[testObserver.name]: 123}}]);

    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(true, {});
      }
    });
    const responseFailed = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[2]).toEqual('Performance.enable');
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseFailed).toEqual([{metric: {}}]);

    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(false, {metrics: []});
      }
    });
    const responseEmptyMetrics = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseEmptyMetrics).toEqual([{metric: {}}]);
  });

  it('should activate the Performance domain and return the requested metric for TotalJsHeapSize', async () => {
    const testObserver = new TotalJsHeapSize();
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(false, {metrics: [{name: testObserver.chromiumCompatibleName, value: 456}]});
      }
    });
    const responseStop = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStop');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[0]).toEqual('Performance.enable');
    expect(executedCommands[1]).toEqual('Performance.getMetrics');
    expect(responseStop).toEqual([{metric: {[testObserver.name]: 456}}]);

    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(true, {});
      }
    });
    const responseFailed = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[2]).toEqual('Performance.enable');
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseFailed).toEqual([{metric: {}}]);

    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(false, {metrics: []});
      }
    });
    const responseEmptyMetrics = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseEmptyMetrics).toEqual([{metric: {}}]);
  });

  it('should skip custom observer if client is not ready', async () => {
    (chromiumDevelopmentTools as any).clients = {};
    const response = await chromiumDevelopmentTools.runCustomObserver(customObserver);

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(response).toEqual([]);
  });

  it('should activate the Performance domain and return the requested metric for AllPerformanceMetrics', async () => {
    const testObserver = new AllPerformanceMetrics();
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(false, {metrics: [{name: 'MetricOne', value: 456}, {name: 'MetricTwo', value: 123}, {name: 'MetricThree', value: 789}]});
      }
    });
    const responseStop = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStop');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[0]).toEqual('Performance.enable');
    expect(executedCommands[1]).toEqual('Performance.getMetrics');
    expect(responseStop).toEqual([{metric: {MetricOne: 456, MetricTwo: 123, MetricThree: 789}}]);

    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(true, {});
      }
    });
    const responseFailed = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[2]).toEqual('Performance.enable');
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseFailed).toEqual([{metric: {}}]);

    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (command === 'Performance.enable') {
        callback(true);
      } else if (command === 'Performance.getMetrics') {
        callback(false, {metrics: []});
      }
    });
    const responseEmptyMetrics = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseEmptyMetrics).toEqual([{metric: {}}]);
  });

  it('should activate multiple domains and return the requested metric for HeapDump', async () => {
    const testObserver = new HeapDump();
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation((command, callback) => {
      executedCommands.push(command);
      if (['HeapProfiler.enable'].includes(command)) {
        callback(true);
      }
    });
    mockClient.HeapProfiler.addHeapSnapshotChunk = jest.fn()
      .mockImplementation((callback) => {
        setTimeout(() => callback({chunk: 'test'}), 1);
        return () => {};
      });
    mockClient.HeapProfiler.reportHeapSnapshotProgress = jest.fn()
      .mockImplementation((callback) => {
        setTimeout(() => callback({finished: true}), 1);
        return () => {};
      });
    const responseStop = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onSampling');
    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[0]).toEqual('HeapProfiler.enable');
    expect(responseStop).toEqual([{metric: {heap: 'test'}}]);

    mockClient.HeapProfiler.addHeapSnapshotChunk = jest.fn()
      .mockImplementation((callback) => {
        setTimeout(() => callback({chunk: 'test2'}), 1);
        return () => {};
      })
    const responseStart = await chromiumDevelopmentTools.getMetric(testObserver.name, 'onStart');
    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[1]).toEqual('HeapProfiler.enable');
    expect(responseStart).toEqual([{metric: {heap: 'test2'}}]);
  });

  it('should run a custom observer', async () => {
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation(async (command, callback) => {
      executedCommands.push(command);
      callback(false, {success: true});
    });
    const response = await chromiumDevelopmentTools.runCustomObserver(customObserver);

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(executedCommands[0]).toEqual('Custom.Protocol.Command');
    expect(response).toEqual([{metric: {success: true}}]);
  });

  it('should skip connection to specific target if already exists', async () => {
    (chromiumDevelopmentTools as any).buildOptions = jest.fn();
    await (chromiumDevelopmentTools as any).connectToTarget({id: 'mockClient'});

    expect((chromiumDevelopmentTools as any).clients['mockClient']).toBeTruthy();
    expect((chromiumDevelopmentTools as any).buildOptions).not.toHaveBeenCalled();
  });

  it('should connect to specific target', async () => {
    const response = (chromiumDevelopmentTools as any).buildOptions('mockTarget');

    expect(response.target).toEqual('mockTarget');
  });

  it('should build options with targetId', async () => {
    (chromiumDevelopmentTools as any).buildOptions = jest.fn();
    await (chromiumDevelopmentTools as any).connectToTarget({id: 'mockTarget'});

    expect((chromiumDevelopmentTools as any).buildOptions).toHaveBeenCalled();
  });

  it('should destroy all client', async () => {
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation(async command =>
      new Promise(resolve => {
        executedCommands.push(command);
        resolve(true);
      }),
    );
    await chromiumDevelopmentTools.destroy();

    expect(executedCommands[0]).toEqual('IO.close');
  });

  it('should destroy specific client that exist', async () => {
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation(async command =>
      new Promise(resolve => {
        executedCommands.push(command);
        resolve(true);
      }),
    );
    await chromiumDevelopmentTools.destroy('mockClient');
    await chromiumDevelopmentTools.destroy('mockClientNotExisting');

    expect(executedCommands[0]).toEqual('IO.close');
    expect(executedCommands.length).toEqual(1);
  });
});
