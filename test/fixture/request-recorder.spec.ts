import {EventEmitter} from 'node:events';
import {
  RequestRecorder,
} from '../../src/fixture/request-recorder.js';

const pageRequest = (url: string, timing: Record<string, number>, status?: number) => ({
  url: () => url,
  method: () => 'GET',
  resourceType: () => 'fetch',
  timing: () => ({startTime: Date.now() - 30, requestStart: -1, responseStart: -1, responseEnd: -1, ...timing}),
  response: async () => (status === undefined ? null : {status: () => status}),
});

describe('Request recorder', () => {
  it('should record the finished and failed requests of the pages', async () => {
    const recorder = new RequestRecorder();
    const context = new EventEmitter();
    recorder.observeContext(context as any);

    context.emit('requestfinished', pageRequest('https://shop.com/api', {requestStart: 10, responseStart: 60, responseEnd: 80}, 200));
    context.emit('requestfailed', pageRequest('https://shop.com/blocked', {}));
    await new Promise(setImmediate);

    // Requests are recorded once their response is known, so in order of completion
    const finished = recorder.requests.find(request => request.url === 'https://shop.com/api');
    const failed = recorder.requests.find(request => request.url === 'https://shop.com/blocked');
    expect(finished).toEqual({
      url: 'https://shop.com/api', method: 'GET', status: 200, resourceType: 'fetch', startTime: expect.any(Number) as number, duration: 80, timeToFirstByte: 50, failed: false, api: false,
    });
    expect(failed).toEqual(expect.objectContaining({status: 0, failed: true, timeToFirstByte: undefined}));
    // Without a response end, the duration lasts until the failure
    expect(failed?.duration).toBeGreaterThanOrEqual(30);
    expect(failed?.duration).toBeLessThan(5000);
  });

  it('should record the requests of the API request context and keep its other members', async () => {
    const recorder = new RequestRecorder();
    const response = (status: number, timing?: Record<string, number>) => ({
      status: () => status, url: () => 'https://api.shop.com/users', ...(timing ? {timing: () => timing} : {}),
    });
    const request = {
      get: jest.fn(async () => response(200, {startTime: 0, requestStart: 5, responseStart: 25, responseEnd: 40})),
      fetch: jest.fn(async () => response(404)),
      post: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      storageState: jest.fn(async () => ({cookies: []})),
    };
    const wrapped = recorder.wrapApiRequest(request as any);

    expect((await wrapped.get('/users')).status()).toBe(200);
    expect((await wrapped.fetch('/missing', {method: 'delete'})).status()).toBe(404);
    await expect(wrapped.post('/users')).rejects.toThrow('ECONNREFUSED');
    expect(await wrapped.storageState()).toEqual({cookies: []});

    expect(request.get).toHaveBeenCalledWith('/users', undefined);
    expect(recorder.requests.map(({method, status, duration, timeToFirstByte, failed, api}) => ({method, status, duration: method === 'GET' ? duration : 'any', timeToFirstByte, failed, api}))).toEqual([
      {method: 'GET', status: 200, duration: 40, timeToFirstByte: 20, failed: false, api: true},
      {method: 'DELETE', status: 404, duration: 'any', timeToFirstByte: undefined, failed: false, api: true},
      {method: 'POST', status: 0, duration: 'any', timeToFirstByte: undefined, failed: true, api: true},
    ]);
    expect(recorder.requests[1].url).toBe('https://api.shop.com/users');
    expect(recorder.requests[2].url).toBe('/users');
  });
});
