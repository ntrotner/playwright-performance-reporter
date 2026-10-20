import type CDP from 'chrome-remote-interface';
import {
  type HookOrder,
  type MetricObserver,
  type SupportedBrowsers,
  type TargetMetric,
} from '../../types/index.js';
import {
  Logger,
} from '../../helpers/index.js';
import {
  ChromiumDevelopmentTools,
} from './client.js';

/**
 * Minimal shape of a Playwright `CDPSession`
 */
export type CdpSessionLike = {
  send(method: string, parameters?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (parameters: any) => void): unknown;
  off(event: string, listener: (parameters: any) => void): unknown;
};

/**
 * Callback of a command in the style of `chrome-remote-interface`
 */
type CommandCallback = (error: boolean, response: unknown) => void;

/**
 * Make a Playwright CDP session usable like a `chrome-remote-interface` client, which observers expect:
 * - `client.send(method, parameters?, callback?)` resolves a promise or calls the callback
 * - `client.Domain.command(parameters?)` sends the command
 * - `client.Domain.event(listener)` subscribes to the event and returns an unsubscribe function
 * - `client.on(event, listener)` subscribes to an event
 *
 * @param session CDP session of a page
 */
export function createCdpSessionClient(session: CdpSessionLike): CDP.Client {
  const send = (method: string, parametersOrCallback?: Record<string, unknown> | CommandCallback, callback?: CommandCallback): Promise<unknown> | undefined => {
    const parameters = typeof parametersOrCallback === 'function' ? undefined : parametersOrCallback;
    const done = typeof parametersOrCallback === 'function' ? parametersOrCallback : callback;
    if (!done) {
      return session.send(method, parameters);
    }

    void (async () => {
      try {
        done(false, await session.send(method, parameters));
      } catch (error: unknown) {
        done(true, error);
      }
    })();

    return undefined;
  };

  const subscribe = (event: string, listener: (parameters: any) => void) => {
    session.on(event, listener);
    return () => session.off(event, listener);
  };

  const domain = (name: string) => new Proxy({}, {
    get: (_, member) => (argument?: unknown): (() => unknown) | Promise<unknown> => typeof argument === 'function'
      ? subscribe(`${name}.${String(member)}`, argument as (parameters: any) => void)
      : session.send(`${name}.${String(member)}`, argument as Record<string, unknown> | undefined),
  });

  return new Proxy({send, on: subscribe}, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof typeof target];
      }

      // Promise resolution checks `then`, which must not look like a CDP domain
      if (typeof property !== 'string' || property === 'then' || !/^[A-Z]/.test(property)) {
        return undefined;
      }

      return domain(property);
    },
  }) as unknown as CDP.Client;
}

/**
 * Chromium client on CDP sessions that were opened by Playwright, instead of a remote debugging port
 */
export class ChromiumSessionDevelopmentTools extends ChromiumDevelopmentTools {
  constructor() {
    super({});
  }

  /**
   * Targets are added by the owner of the sessions, so there is nothing to discover
   */
  public override async connect(): Promise<void> {}

  /**
   * Measure a target from now on
   *
   * @param target metadata of the target, e.g. id and url
   * @param client client of the target
   */
  public addTarget(target: CDP.Target, client: CDP.Client): void {
    this.clients[target.id] = client;
    this.targets[target.id] = target;
  }

  /**
   * Update the metadata of a target, e.g. after a navigation
   *
   * @param targetId id of the target
   * @param target changed metadata
   */
  public updateTarget(targetId: string, target: Partial<CDP.Target>): void {
    if (this.targets[targetId]) {
      Object.assign(this.targets[targetId], target);
    }
  }
}

/**
 * Client for browsers without CDP, e.g. Firefox and WebKit, which only supports `Runtime.evaluate` by
 * running the expression in the page. Every other command fails, and events are never emitted.
 *
 * @param evaluate runs an expression in the page and returns its value, e.g. `page.evaluate`
 * @param browser name of the browser, for error messages
 */
export function createEvaluateClient(evaluate: (expression: string) => Promise<unknown>, browser: string): CDP.Client {
  const run = async (method: string, parameters?: Record<string, unknown>): Promise<unknown> => {
    if (method !== 'Runtime.evaluate') {
      throw new Error(`${method} is not available in ${browser}`);
    }

    try {
      const expression = typeof parameters?.expression === 'string' ? parameters.expression : '';
      const value = await evaluate(expression);
      return {result: {type: typeof value === 'object' && value !== null ? 'object' : typeof value, value}};
    } catch (error: unknown) {
      return {result: {type: 'object', subtype: 'error'}, exceptionDetails: {text: String(error)}};
    }
  };

  return createCdpSessionClient({
    send: run,
    on() {},
    off() {},
  });
}

/**
 * Browser client on pages without CDP, which only runs observers that evaluate JavaScript in the page
 */
export class EvaluateDevelopmentTools extends ChromiumSessionDevelopmentTools {
  /**
   * Observers that were reported as unsupported once
   */
  private readonly warned = new Set<string>();

  constructor(private readonly browser: Exclude<SupportedBrowsers, 'chromium'>) {
    super();
  }

  /**
   * @inheritdoc
   */
  public override getBrowserName(): SupportedBrowsers {
    return this.browser;
  }

  /**
   * Run evaluate-only observers, and mark the others as unsupported at their stop
   *
   * @param metric observer to run
   * @param hookOrder hook order
   */
  public override async getMetric(metric: MetricObserver<CDP.Client>, hookOrder: HookOrder): Promise<TargetMetric[]> {
    if (metric.capabilities?.includes('evaluate')) {
      return super.getMetric(metric, hookOrder);
    }

    if (!this.warned.has(metric.name)) {
      this.warned.add(metric.name);
      Logger.warning(`Observer "${metric.name}" needs the Chrome DevTools Protocol and is not supported in ${this.browser}`);
    }

    return hookOrder === 'onStop' ? Object.values(this.targets).map(target => ({...target, metric: {unsupported: metric.name}})) : [];
  }
}
