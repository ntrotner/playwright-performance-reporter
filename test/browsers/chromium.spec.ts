import {ChromiumDevelopmentTools} from '../../src/browsers/chromium/index.js';
import {
  AllPerformanceMetrics,
  TotalJsHeapSize,
  UsedJsHeapSize,
} from '../../src/browsers/chromium/observers/index.js';
import {
  type ChromiumSupportedMetrics,
  type OnStartMeasure,
} from '../../src/types/index.js';
import {ChromiumCDPFixture} from '../fixtures/chromium-cdp.fixture.js';

const customObserver: OnStartMeasure = async (accumulator, client) => new Promise(resolve => {
  client.send('Custom.Protocol.Command' as any, (error, response) => {
    if (!error) {
      accumulator.push(response);
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
    (chromiumDevelopmentTools as any).client = mockClient;
  });

  it('should give the correct browser name', () => {
    expect(chromiumDevelopmentTools.getBrowserName()).toEqual('chromium');
  });

  it('should return an empty list if metric is unsupported', async () => {
    const response = await chromiumDevelopmentTools.getMetric('unrelated' as ChromiumSupportedMetrics, 'onStart');

    expect((chromiumDevelopmentTools as any).connect).toHaveBeenCalled();
    expect(response).toEqual([]);
  });

  it('should not activate Performance domain if client is not ready', async () => {
    (chromiumDevelopmentTools as any).client = undefined;
    const response = await (chromiumDevelopmentTools as any).startPerformance();

    expect(response).toBe(false);
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(false);
  });

  it('should skip domain activation when client is not ready', async () => {
    (chromiumDevelopmentTools as any).client = undefined;
    await (chromiumDevelopmentTools as any).activateDomain({name: 'totalJsHeapSize'});

    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(false);
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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[0]).toEqual('Performance.enable');
    expect(executedCommands[1]).toEqual('Performance.getMetrics');
    expect(responseStop).toEqual([{[testObserver.name]: 123}]);

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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[2]).toEqual('Performance.enable');
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseFailed).toEqual([]);

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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseEmptyMetrics).toEqual([]);
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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[0]).toEqual('Performance.enable');
    expect(executedCommands[1]).toEqual('Performance.getMetrics');
    expect(responseStop).toEqual([{[testObserver.name]: 456}]);

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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[2]).toEqual('Performance.enable');
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseFailed).toEqual([]);

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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseEmptyMetrics).toEqual([]);
  });

  it('should skip custom observer if client is not ready', async () => {
    (chromiumDevelopmentTools as any).client = undefined;
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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[0]).toEqual('Performance.enable');
    expect(executedCommands[1]).toEqual('Performance.getMetrics');
    expect(responseStop).toEqual([{MetricOne: 456, MetricTwo: 123, MetricThree: 789}]);

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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[2]).toEqual('Performance.enable');
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseFailed).toEqual([]);

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
    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(true);
    expect(executedCommands[3]).toEqual('Performance.getMetrics');
    expect(responseEmptyMetrics).toEqual([]);
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
    expect(response).toEqual([{success: true}]);
  });

  it('should destroy client', async () => {
    const executedCommands: string[] = [];
    mockClient.send.mockImplementation(async command =>
      new Promise(resolve => {
        executedCommands.push(command);
        resolve(true);
      }),
    );
    await chromiumDevelopmentTools.destroy();

    expect((chromiumDevelopmentTools as any).isPerformanceActive).toBe(false);
    expect(executedCommands[0]).toEqual('IO.close');
  });
});
