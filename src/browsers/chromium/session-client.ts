import type CDP from 'chrome-remote-interface';
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
