import type CDP from 'chrome-remote-interface';
import {
  ChromiumDevelopmentTools,
} from '../../src/browsers/chromium/index.js';
import {
  nativeChromiumPlugins,
} from '../../src/index.js';
import {
  Logger,
  resolveConditions,
} from '../../src/helpers/index.js';
import {
  ChromiumCDPFixture,
} from '../fixtures/chromium-cdp.fixture.js';

describe('Throttling', () => {
  let mockClient: ChromiumCDPFixture;
  let client: CDP.Client;

  beforeEach(() => {
    mockClient = new ChromiumCDPFixture();
    mockClient.send.mockResolvedValue({});
    client = mockClient as unknown as CDP.Client;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should throttle CPU and network, and disable the cache', async () => {
    await nativeChromiumPlugins.createThrottlingPlugin(resolveConditions({cpuSlowdown: 4, network: 'slow-4g', disableCache: true})!)(client);

    expect(mockClient.send.mock.calls).toEqual([
      ['Emulation.setCPUThrottlingRate', {rate: 4}],
      ['Network.enable'],
      ['Network.emulateNetworkConditions', {
        offline: false, latency: 562.5, downloadThroughput: 1474.56 * 1024 / 8, uploadThroughput: 675 * 1024 / 8,
      }],
      ['Network.setCacheDisabled', {cacheDisabled: true}],
    ]);
  });

  it('should only send the configured conditions', async () => {
    await nativeChromiumPlugins.createThrottlingPlugin(resolveConditions({cpuSlowdown: 2})!)(client);
    expect(mockClient.send.mock.calls).toEqual([['Emulation.setCPUThrottlingRate', {rate: 2}]]);

    mockClient.send.mockClear();
    await nativeChromiumPlugins.createThrottlingPlugin(resolveConditions({network: 'offline'})!)(client);
    expect(mockClient.send.mock.calls).toEqual([
      ['Network.enable'],
      ['Network.emulateNetworkConditions', {
        offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
      }],
    ]);
  });

  describe('Chromium client', () => {
    const applyConditions = async (tools: ChromiumDevelopmentTools, type: string) => (tools as unknown as {
      applyConditions: (client: CDP.Client, target: Partial<CDP.Target>) => Promise<void>;
    }).applyConditions(client, {type, url: 'https://example.com'});

    it('should throttle pages and frames, but not workers', async () => {
      const tools = new ChromiumDevelopmentTools({}, resolveConditions({cpuSlowdown: 4}));

      await applyConditions(tools, 'page');
      await applyConditions(tools, 'iframe');
      await applyConditions(tools, 'service_worker');

      expect(mockClient.send).toHaveBeenCalledTimes(2);
    });

    it('should not throttle without conditions', async () => {
      await applyConditions(new ChromiumDevelopmentTools({}), 'page');

      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('should only warn if throttling fails', async () => {
      const warningSpy = jest.spyOn(Logger, 'warning').mockImplementation(() => {});
      mockClient.send.mockRejectedValue(new Error('Not supported'));

      await expect(applyConditions(new ChromiumDevelopmentTools({}, resolveConditions({cpuSlowdown: 4})), 'page')).resolves.toBeUndefined();
      expect(warningSpy).toHaveBeenCalledWith('Failed to apply conditions "CPU 4x slowdown" to target', 'https://example.com', 'Error: Not supported');
    });
  });
});
