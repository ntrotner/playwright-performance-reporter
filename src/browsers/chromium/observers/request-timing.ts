import type CDP from 'chrome-remote-interface';
import {
  type ChromiumMetricObserver,
  type Metric,
} from '../../../types/index.js';
import {
  assignConfig,
  globToRegExp,
} from '../../../helpers/index.js';
import {
  percentile,
} from '../../../presenters/comparison-presenter/comparison.js';
import {
  type RecordedRequest,
} from '../../../fixture/request-recorder.js';

/**
 * Endpoint with its own duration metric
 */
export type RequestTimingEndpoint = {
  /**
   * Name in the metric `requestDuration:<name>`
   */
  name: string;

  /**
   * Glob pattern (`*` and `?`) of the url
   */
  pattern: string;
};

/**
 * Options for the RequestTimingObserver
 */
export type RequestTimingObserverOptions = {
  /**
   * Endpoints with their own 95th percentile of the duration, e.g. `{name: 'search', pattern: '*\/api/search*'}`
   */
  endpoints: RequestTimingEndpoint[];

  /**
   * Amount of requests in `slowestRequests`. Defaults to 5.
   */
  topSlowest: number;
};

/**
 * Source of the recorded requests of a test
 */
export type RequestSource = {
  readonly requests: RecordedRequest[];
};

/**
 * Recorded requests per client of the recording target of the fixture
 */
const requestSources = new WeakMap<CDP.Client, RequestSource>();

/**
 * Connect the recorded requests of a test to the client of its recording target
 *
 * @param client client of the recording target
 * @param source recorded requests
 */
export function registerRequestSource(client: CDP.Client, source: RequestSource): void {
  requestSources.set(client, source);
}

/**
 * Measures the duration of the requests of the pages and of the API request context of a test or step,
 * as recorded by Playwright. Works without a page, e.g. in API tests, but only in the fixture mode.
 */
export class RequestTimingObserver implements ChromiumMetricObserver {
  public readonly name = 'requestTiming';
  public readonly plugins = [];

  /**
   * Reads what Playwright recorded, so it runs on the recording target of the fixture
   */
  public readonly capabilities = ['playwright'] as const;

  private readonly options: RequestTimingObserverOptions = {
    endpoints: [],
    topSlowest: 5,
  };

  /**
   * Amount of recorded requests at the latest start per source
   */
  private readonly starts = new WeakMap<RequestSource, number>();

  private readonly endpoints: Array<{name: string; pattern: RegExp}>;

  constructor(options?: Partial<RequestTimingObserverOptions>) {
    assignConfig(this.options, options);
    this.endpoints = this.options.endpoints.map(endpoint => ({name: endpoint.name, pattern: globToRegExp(endpoint.pattern)}));
  }

  /**
   * @inheritdoc
   */
  async onStart(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    const source = requestSources.get(developmentTools);
    if (source) {
      this.starts.set(source, source.requests.length);
      Object.assign(accumulator, this.summarize([]));
    }
  }

  /**
   * @inheritdoc
   */
  async onSampling(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    this.common(accumulator, developmentTools);
  }

  /**
   * @inheritdoc
   */
  async onStop(accumulator: Metric, developmentTools: CDP.Client): Promise<void> {
    this.common(accumulator, developmentTools);
  }

  /**
   * Summarize the requests since the latest start
   */
  private common(accumulator: Metric, client: CDP.Client): void {
    const source = requestSources.get(client);
    if (!source) {
      return;
    }

    Object.assign(accumulator, this.summarize(source.requests.slice(this.starts.get(source) ?? 0)));
  }

  /**
   * Counts, percentiles of the durations and the slowest requests
   *
   * @param requests recorded requests
   */
  private summarize(requests: RecordedRequest[]): Metric {
    const finished = requests.filter(request => !request.failed);
    const durations = finished.map(request => request.duration);
    const api = finished.filter(request => request.api).map(request => request.duration);
    const timesToFirstByte = finished.map(request => request.timeToFirstByte).filter(value => value !== undefined);
    const of = (values: number[], fraction: number) => values.length > 0 ? percentile(values, fraction) : 0;

    const result: Metric = {
      requestCount: requests.length,
      requestFailedCount: requests.length - finished.length,
      requestDurationP50: of(durations, 0.5),
      requestDurationP95: of(durations, 0.95),
      requestDurationMax: durations.length > 0 ? Math.max(...durations) : 0,
      apiRequestCount: requests.filter(request => request.api).length,
      apiRequestDurationP95: of(api, 0.95),
      slowestRequests: JSON.stringify([...requests]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, this.options.topSlowest)
        .map(({
          url, method, status, resourceType, duration,
        }) => ({
          url, method, status, resourceType, duration,
        }))),
    };

    // Unknown for requests without timing, e.g. of the API request context in older Playwright versions
    if (timesToFirstByte.length > 0) {
      result.requestTtfbP95 = percentile(timesToFirstByte, 0.95);
    }

    for (const endpoint of this.endpoints) {
      const matching = finished.filter(request => endpoint.pattern.test(request.url)).map(request => request.duration);
      if (matching.length > 0) {
        result[`requestDuration:${endpoint.name}`] = percentile(matching, 0.95);
      }
    }

    return result;
  }
}
