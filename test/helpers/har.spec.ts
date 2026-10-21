import {
  buildHar,
  harTimings,
  type NetworkRequestRecord,
  siteOf,
} from '../../src/helpers/index.js';

const record = (overrides: Partial<NetworkRequestRecord> = {}): NetworkRequestRecord => ({
  requestId: '1',
  url: 'https://example.com/app.js?v=2',
  method: 'GET',
  requestHeaders: {accept: '*/*'},
  resourceType: 'Script',
  documentUrl: 'https://example.com/',
  wallTime: 1_700_000_000,
  timestamp: 100,
  status: 200,
  statusText: 'OK',
  responseHeaders: {'content-type': 'text/javascript'},
  mimeType: 'text/javascript',
  protocol: 'h2',
  encodedDataLength: 2048,
  endTimestamp: 100.5,
  ...overrides,
});

describe('HAR helpers', () => {
  it('should convert the CDP timing into HAR phases', () => {
    const timing = {
      requestTime: 100.01, dnsStart: 2, dnsEnd: 12, connectStart: 12, connectEnd: 40, sslStart: 20, sslEnd: 40, sendStart: 41, sendEnd: 42, receiveHeadersEnd: 142,
    };

    expect(harTimings(record({timing: timing as any}))).toEqual({
      blocked: 12, dns: 10, connect: 28, ssl: 20, send: 1, wait: 100, receive: 348,
    });
  });

  it('should treat a request without timing, e.g. from the cache, as receive only', () => {
    expect(harTimings(record({endTimestamp: 100.25}))).toEqual({
      blocked: 0, dns: -1, connect: -1, ssl: -1, send: 0, wait: 0, receive: 250,
    });
    expect(harTimings(record({endTimestamp: undefined})).receive).toBe(0);
  });

  it('should build a HAR 1.2 log with one page', () => {
    const har = buildHar([
      record({requestId: '2', timestamp: 101, wallTime: 1_700_000_001, url: 'https://cdn.com/a.png', resourceType: 'Image', fromCache: true, errorText: 'net::ERR_ABORTED'}),
      record({redirectURL: 'https://example.com/next'}),
    ], {id: 'page_1', title: 'Open profile'}, {name: 'test', version: '1'});

    expect(har.log.version).toBe('1.2');
    expect(har.log.pages).toEqual([{id: 'page_1', title: 'Open profile', startedDateTime: '2023-11-14T22:13:20.000Z', pageTimings: {onContentLoad: -1, onLoad: -1}}]);
    const [first, second] = har.log.entries;
    expect(first).toEqual(expect.objectContaining({
      pageref: 'page_1',
      startedDateTime: '2023-11-14T22:13:20.000Z',
      time: 500,
      _resourceType: 'script',
      _transferSize: 2048,
      cache: {},
    }));
    expect(first.request).toEqual(expect.objectContaining({
      method: 'GET', httpVersion: 'h2', headers: [{name: 'accept', value: '*/*'}], queryString: [{name: 'v', value: '2'}],
    }));
    expect(first.response).toEqual(expect.objectContaining({
      status: 200, redirectURL: 'https://example.com/next', bodySize: 2048, content: {size: -1, mimeType: 'text/javascript'},
    }));
    expect(second.response._error).toBe('net::ERR_ABORTED');
    expect(second._transferSize).toBe(0);
    expect(buildHar([], {id: 'p', title: ''}, {name: 'test', version: '1'}).log.entries).toEqual([]);
  });

  it.each([
    ['https://www.example.com/a', 'example.com'],
    ['https://cdn.shop.co.uk/a', 'shop.co.uk'],
    ['https://github.githubassets.com/a', 'githubassets.com'],
    ['http://localhost:3000/a', 'localhost'],
    ['http://127.0.0.1:8080/a', '127.0.0.1'],
    ['not a url', ''],
  ])('should approximate the site of %s as %s', (url, site) => {
    expect(siteOf(url)).toBe(site);
  });
});
