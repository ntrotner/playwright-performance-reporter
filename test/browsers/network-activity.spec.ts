import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type CDP from 'chrome-remote-interface';
import {
  nativeChromiumObservers,
} from '../../src/index.js';
import {
  type Har,
} from '../../src/helpers/index.js';

type Listener = (event: any) => void;

/**
 * Client whose Network events can be emitted
 */
function createClient() {
  const listeners: Record<string, Listener> = {};
  const subscribe = (event: string) => jest.fn((listener: Listener) => {
    listeners[event] = listener;
    return () => {};
  });
  const client = {
    send: jest.fn(),
    Network: {
      requestWillBeSent: subscribe('requestWillBeSent'),
      responseReceived: subscribe('responseReceived'),
      loadingFinished: subscribe('loadingFinished'),
      loadingFailed: subscribe('loadingFailed'),
    },
  };

  const emit = (event: string, parameters: unknown) => {
    listeners[event](parameters);
  };

  return {
    cdp: client as unknown as CDP.Client,
    client,
    request(requestId: string, url: string, type: string, wallTime: number, extra: Record<string, unknown> = {}) {
      emit('requestWillBeSent', {
        requestId, type, documentURL: 'https://shop.com/', wallTime, timestamp: wallTime - 1000, request: {url, method: 'GET', headers: {}}, ...extra,
      });
    },
    respond(requestId: string, url: string, status = 200, extra: Record<string, unknown> = {}) {
      emit('responseReceived', {requestId, response: {url, status, statusText: 'OK', headers: {}, mimeType: 'text/plain', protocol: 'h2', ...extra}});
    },
    finish(requestId: string, encodedDataLength: number, timestamp: number) {
      emit('loadingFinished', {requestId, encodedDataLength, timestamp});
    },
    fail(requestId: string, timestamp: number) {
      emit('loadingFailed', {requestId, errorText: 'net::ERR_FAILED', timestamp});
    },
  };
}

describe('Network activity observer', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-activity-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true});
  });

  it('should subscribe every new client, e.g. of the next test', async () => {
    const observer = new nativeChromiumObservers.networkActivity();
    const first = createClient();
    const second = createClient();

    await observer.onStart({}, first.cdp);
    await observer.onSampling({}, first.cdp);
    await observer.onStart({}, second.cdp);

    expect(first.client.Network.requestWillBeSent).toHaveBeenCalledTimes(1);
    expect(second.client.Network.requestWillBeSent).toHaveBeenCalledTimes(1);
  });

  it('should break the transfer down by resource type and third parties', async () => {
    const observer = new nativeChromiumObservers.networkActivity();
    const page = createClient();
    const accumulator: Record<string, string | number> = {};

    await observer.onStart({}, page.cdp);
    page.request('1', 'https://www.shop.com/', 'Document', 2000);
    page.respond('1', 'https://www.shop.com/');
    page.finish('1', 5000, 1001);
    page.request('2', 'https://cdn.ads.net/ad.js', 'Script', 2000.1);
    page.respond('2', 'https://cdn.ads.net/ad.js');
    page.finish('2', 3000, 1001);
    page.request('3', 'https://shop.com/logo.png', 'Image', 2000.2);
    page.respond('3', 'https://shop.com/logo.png', 200, {fromDiskCache: true});
    page.finish('3', 0, 1001);
    page.request('4', 'https://shop.com/ping', 'Ping', 2000.3);
    page.fail('4', 1001);
    await observer.onStop(accumulator, page.cdp);

    expect(accumulator).toEqual(expect.objectContaining({
      totalNetworkRequests: 3,
      totalNetworkDocumentRequests: 1,
      totalNetworkDocumentTransferSize: 5000,
      totalNetworkScriptRequests: 1,
      totalNetworkScriptTransferSize: 3000,
      totalNetworkImageRequests: 1,
      totalNetworkImageTransferSize: 0,
      totalNetworkOtherRequests: 1,
      totalNetworkThirdPartyRequests: 1,
      totalNetworkThirdPartyTransferSize: 3000,
    }));
    expect(accumulator).not.toHaveProperty('harFile');

    const withHosts = new nativeChromiumObservers.networkActivity({firstPartyHosts: ['*.ads.net']});
    const other = createClient();
    const hosts: Record<string, string | number> = {};
    await withHosts.onStart({}, other.cdp);
    other.request('1', 'https://cdn.ads.net/ad.js', 'Script', 2000);
    other.request('2', 'https://shop.com/', 'Document', 2000);
    await withHosts.onStop(hosts, other.cdp);
    expect(hosts).toEqual(expect.objectContaining({totalNetworkThirdPartyRequests: 1}));
  });

  it('should write the requests since the start into a HAR file, with redirects as separate entries', async () => {
    const observer = new nativeChromiumObservers.networkActivity({har: {outputDir: path.join(outputDir, 'har'), filePrefix: 'step', urlFilter: '*shop.com*'}});
    const page = createClient();
    const accumulator: Record<string, string | number> = {};

    await observer.onStart({}, page.cdp);
    // Before the start of the step
    page.request('0', 'https://shop.com/old', 'Document', 1);
    await observer.onStart({}, page.cdp);
    const now = Date.now() / 1000;
    page.request('1', 'https://shop.com/login', 'Document', now);
    page.request('1', 'https://shop.com/home', 'Document', now + 0.1, {redirectResponse: {url: 'https://shop.com/login', status: 302, statusText: 'Found', headers: {}, encodedDataLength: 100}});
    page.respond('1', 'https://shop.com/home');
    page.finish('1', 4000, now - 999);
    page.request('2', 'https://tracker.io/t.js', 'Script', now + 0.2);
    await observer.onStop(accumulator, page.cdp);

    expect(String(accumulator.harFile)).toMatch(/har\/step-.*-1\.har$/);
    const har = JSON.parse(fs.readFileSync(String(accumulator.harFile), 'utf8')) as Har;
    expect(har.log.pages[0].title).toBe('https://shop.com/login');
    expect(har.log.entries.map(entry => [entry.request.url, entry.response.status, entry.response.redirectURL])).toEqual([
      ['https://shop.com/login', 302, 'https://shop.com/home'],
      ['https://shop.com/home', 200, ''],
    ]);
    expect(har.log.entries[1]._transferSize).toBe(4000);
  });
});
