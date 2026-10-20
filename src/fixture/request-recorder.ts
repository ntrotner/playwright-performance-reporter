import type {
  APIRequestContext,
  APIResponse,
  BrowserContext,
  Request,
} from '@playwright/test';

/**
 * Request of a page or of the API request context, as recorded by Playwright
 */
export type RecordedRequest = {
  url: string;
  method: string;

  /**
   * HTTP status, 0 if the request failed
   */
  status: number;

  /**
   * Resource type of a page request, e.g. `document`, `fetch`, or `api` for the API request context
   */
  resourceType: string;

  /**
   * Wall time of the start in milliseconds since epoch
   */
  startTime: number;

  /**
   * Milliseconds until the response was received completely
   */
  duration: number;

  /**
   * Milliseconds from sending the request until the first byte of the response, if known
   */
  timeToFirstByte?: number;
  failed: boolean;
  api: boolean;
};

/**
 * Methods of the API request context that send a request
 */
const apiMethods = new Set(['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head']);

/**
 * Optional timing of an API response, available in newer Playwright versions
 */
type TimedApiResponse = APIResponse & {timing?: () => {startTime: number; requestStart: number; responseStart: number; responseEnd: number}};

/**
 * Records the requests of the pages of a context and of the API request context of a test
 */
export class RequestRecorder {
  public readonly requests: RecordedRequest[] = [];

  /**
   * Record the finished and failed requests of every page of the context
   *
   * @param context browser context of the test
   */
  public observeContext(context: BrowserContext): void {
    context.on('requestfinished', request => {
      void this.recordPageRequest(request, false);
    });
    context.on('requestfailed', request => {
      void this.recordPageRequest(request, true);
    });
  }

  /**
   * Record every request sent with the API request context
   *
   * @param request API request context of the test
   * @returns the same API request context, which records its requests
   */
  public wrapApiRequest(request: APIRequestContext): APIRequestContext {
    return new Proxy(request, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== 'string' || !apiMethods.has(property) || typeof value !== 'function') {
          return value;
        }

        return async (url: string, options?: {method?: string}) => this.recordApiRequest(
          property === 'fetch' ? (options?.method ?? 'GET').toUpperCase() : property.toUpperCase(),
          url,
          async () => (value as (...arguments_: unknown[]) => Promise<APIResponse>).call(target, url, options),
        );
      },
    });
  }

  /**
   * Record a request of a page from its timing
   *
   * @param request finished or failed request
   * @param failed whether the request failed
   */
  private async recordPageRequest(request: Request, failed: boolean): Promise<void> {
    const timing = request.timing();
    let status = 0;
    if (!failed) {
      try {
        const response = await request.response();
        status = response?.status() ?? 0;
      } catch {}
    }

    const end = timing.responseEnd >= 0 ? timing.responseEnd : Date.now() - timing.startTime;
    this.requests.push({
      url: request.url(),
      method: request.method(),
      status,
      resourceType: request.resourceType(),
      startTime: timing.startTime,
      duration: Math.max(0, end),
      timeToFirstByte: timing.responseStart >= 0 && timing.requestStart >= 0 ? timing.responseStart - timing.requestStart : undefined,
      failed,
      api: false,
    });
  }

  /**
   * Send and record a request of the API request context
   *
   * @param method HTTP method
   * @param url url of the request
   * @param send sends the request
   */
  private async recordApiRequest(method: string, url: string, send: () => Promise<APIResponse>): Promise<APIResponse> {
    const startTime = Date.now();
    const record = (status: number, failed: boolean, response?: TimedApiResponse) => {
      const timing = response?.timing?.();
      this.requests.push({
        url: response?.url() ?? url,
        method,
        status,
        resourceType: 'api',
        startTime,
        duration: timing && timing.responseEnd >= 0 ? timing.responseEnd : Date.now() - startTime,
        timeToFirstByte: timing && timing.responseStart >= 0 && timing.requestStart >= 0 ? timing.responseStart - timing.requestStart : undefined,
        failed,
        api: true,
      });
    };

    try {
      const response = await send() as TimedApiResponse;
      record(response.status(), false, response);
      return response;
    } catch (error) {
      record(0, true);
      throw error;
    }
  }
}
