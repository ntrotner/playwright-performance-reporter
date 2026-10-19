import type Protocol from 'devtools-protocol/types/protocol';

/**
 * Request as observed via the CDP Network domain
 */
export type NetworkRequestRecord = {
  requestId: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;

  /**
   * CDP resource type, e.g. `Document`, `Script`, `Image`, `XHR`
   */
  resourceType: string;

  /**
   * Url of the document that started the request
   */
  documentUrl: string;

  /**
   * Wall time of the start in seconds since epoch
   */
  wallTime: number;

  /**
   * Monotonic time of the start in seconds
   */
  timestamp: number;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  mimeType?: string;
  protocol?: string;
  timing?: Protocol.Network.ResourceTiming;
  fromCache?: boolean;

  /**
   * Bytes received over the network, including headers
   */
  encodedDataLength?: number;

  /**
   * Monotonic time of the end in seconds
   */
  endTimestamp?: number;
  errorText?: string;
  redirectURL?: string;
};

/**
 * Timings of an entry in milliseconds, -1 if a phase did not happen
 */
export type HarTimings = {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
};

/**
 * Entry of a HAR 1.2 log
 */
export type HarEntry = {
  pageref: string;
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{name: string; value: string}>;
    queryString: Array<{name: string; value: string}>;
    cookies: Array<{name: string; value: string}>;
    headersSize: -1;
    bodySize: -1;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{name: string; value: string}>;
    cookies: Array<{name: string; value: string}>;
    content: {size: number; mimeType: string};
    redirectURL: string;
    headersSize: -1;
    bodySize: number;
    _error?: string;
  };
  cache: Record<string, never>;
  timings: HarTimings;
  _resourceType: string;
  _transferSize: number;
};

/**
 * HAR 1.2 document
 */
export type Har = {
  log: {
    version: '1.2';
    creator: {name: string; version: string};
    pages: Array<{id: string; title: string; startedDateTime: string; pageTimings: {onContentLoad: -1; onLoad: -1}}>;
    entries: HarEntry[];
  };
};

/**
 * Headers as list of name and value
 *
 * @param headers headers object
 */
function headerList(headers: Record<string, string> | undefined): Array<{name: string; value: string}> {
  return Object.entries(headers ?? {}).map(([name, value]) => ({name, value: String(value)}));
}

/**
 * Round to microsecond precision
 *
 * @param milliseconds duration
 */
function round(milliseconds: number): number {
  return Math.round(milliseconds * 1000) / 1000;
}

/**
 * Phases of a request, following the HAR export of Chrome DevTools
 *
 * @param record observed request
 */
export function harTimings(record: NetworkRequestRecord): HarTimings {
  const total = record.endTimestamp === undefined ? 0 : Math.max(0, (record.endTimestamp - record.timestamp) * 1000);
  const {timing} = record;
  if (!timing) {
    return {
      blocked: 0, dns: -1, connect: -1, ssl: -1, send: 0, wait: 0, receive: round(total),
    };
  }

  const phase = (start: number, end: number) => start >= 0 && end >= start ? round(end - start) : -1;
  // Offsets of the timing are relative to its request time, which can be after the start of the request
  const queued = Math.max(0, (timing.requestTime - record.timestamp) * 1000);
  const firstPhase = [timing.dnsStart, timing.connectStart, timing.sendStart].find(value => value >= 0) ?? 0;
  const receive = record.endTimestamp === undefined ? 0 : ((record.endTimestamp - timing.requestTime) * 1000) - timing.receiveHeadersEnd;

  return {
    blocked: round(queued + firstPhase),
    dns: phase(timing.dnsStart, timing.dnsEnd),
    connect: phase(timing.connectStart, timing.connectEnd),
    ssl: phase(timing.sslStart, timing.sslEnd),
    send: round(Math.max(0, timing.sendEnd - timing.sendStart)),
    wait: round(Math.max(0, timing.receiveHeadersEnd - timing.sendEnd)),
    receive: round(Math.max(0, receive)),
  };
}

/**
 * Query string of a url
 *
 * @param url url of the request
 */
function queryString(url: string): Array<{name: string; value: string}> {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({name, value}));
  } catch {
    return [];
  }
}

/**
 * Create a HAR 1.2 document with a single page
 *
 * @param records observed requests
 * @param page id and title of the page, e.g. the step
 * @param creator name and version of the creator
 */
export function buildHar(records: NetworkRequestRecord[], page: {id: string; title: string}, creator: {name: string; version: string}): Har {
  const entries = [...records].sort((a, b) => a.timestamp - b.timestamp).map((record): HarEntry => {
    const timings = harTimings(record);
    const time = [timings.blocked, timings.dns, timings.connect, timings.send, timings.wait, timings.receive]
      .filter(value => value > 0)
      .reduce((total, value) => total + value, 0);
    return {
      pageref: page.id,
      startedDateTime: new Date(record.wallTime * 1000).toISOString(),
      time: round(time),
      request: {
        method: record.method,
        url: record.url,
        httpVersion: record.protocol ?? '',
        headers: headerList(record.requestHeaders),
        queryString: queryString(record.url),
        cookies: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: record.status ?? 0,
        statusText: record.statusText ?? '',
        httpVersion: record.protocol ?? '',
        headers: headerList(record.responseHeaders),
        cookies: [],
        content: {size: -1, mimeType: record.mimeType ?? ''},
        // Field name of the HAR specification
        // eslint-disable-next-line @typescript-eslint/naming-convention
        redirectURL: record.redirectURL ?? '',
        headersSize: -1,
        bodySize: record.encodedDataLength ?? -1,
        ...(record.errorText ? {_error: record.errorText} : {}),
      },
      cache: {},
      timings,
      _resourceType: record.resourceType.toLowerCase(),
      _transferSize: record.fromCache ? 0 : (record.encodedDataLength ?? 0),
    };
  });

  const startedDateTime = entries[0]?.startedDateTime ?? new Date().toISOString();
  return {
    log: {
      version: '1.2',
      creator,
      pages: [{
        id: page.id, title: page.title, startedDateTime, pageTimings: {onContentLoad: -1, onLoad: -1},
      }],
      entries,
    },
  };
}

/**
 * Registrable domain of a host, approximated without the public suffix list:
 * the last two labels, or three for short second level labels like `co.uk`
 *
 * @param url url to get the site of
 */
export function siteOf(url: string): string {
  let hostname: string;
  try {
    ({hostname} = new URL(url));
  } catch {
    return '';
  }

  if (/^[\d.]+$/.test(hostname) || hostname.includes(':') || !hostname.includes('.')) {
    return hostname;
  }

  const labels = hostname.split('.');
  const keep = labels.length > 2 && labels.at(-2)!.length <= 3 && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-keep).join('.');
}
