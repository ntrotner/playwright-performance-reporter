import {
  Buffer,
} from 'node:buffer';

/**
 * Block of a message, in the shape of the Anthropic Messages API
 */
export type ContentBlock =
  | {type: 'text'; text: string}
  | {type: 'tool_use'; id: string; name: string; input: unknown}
  | {type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean}
  | ({type: string} & Record<string, unknown>);

/**
 * Message of the conversation with the model
 */
export type AgentMessage = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

/**
 * Conversation sent to the model
 */
export type CompletionPrompt = {
  system: string;
  messages: AgentMessage[];
};

/**
 * Tool offered to the model
 */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Settings of a model call
 */
export type CompletionOptions = {
  model: string;
  maxTokens: number;
  tools: ToolDefinition[];

  /**
   * Aborts the call, including its retries, e.g. once the time budget of the agent is spent
   */
  signal?: AbortSignal;
};

/**
 * Answer of the model
 */
export type CompletionResult = {
  content: ContentBlock[];

  /**
   * E.g. `tool_use`, `end_turn`, `max_tokens` or `refusal`
   */
  stopReason: string;
};

/**
 * The only seam to a model: one call with the conversation and the tools
 */
export type Complete = (prompt: CompletionPrompt, options: CompletionOptions) => Promise<CompletionResult>;

/**
 * Model of the default `complete`, unless `ATTRIBUTION_MODEL` or `--model` is set
 */
export const defaultModel = 'claude-opus-5';

/**
 * Milliseconds a single model call may take
 */
const requestTimeoutInMilliseconds = 10 * 60 * 1000;

/**
 * Status codes worth retrying: timeout, conflict, rate limit, and server errors including 529 (overloaded)
 */
const retryableStatus = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

/**
 * Longest wait between two attempts, also for a `retry-after` of the API
 */
const maxRetryDelayInMilliseconds = 60_000;

/**
 * Settings of the default `complete`
 */
export type AnthropicCompleteOptions = {
  /**
   * Defaults to `https://api.anthropic.com`
   */
  baseUrl?: string;

  /**
   * Defaults to the global fetch
   */
  fetch?: typeof fetch;

  /**
   * Retries of a failed call, on a retryable status or a connection error. Defaults to 4.
   */
  maxRetries?: number;

  /**
   * Wait before a retry, resolving early never. Defaults to a timer that rejects when the signal aborts.
   */
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Random number in [0, 1) for the jitter. Defaults to `Math.random`.
   */
  random?: () => number;
};

/**
 * Wait, unless the signal aborts first
 *
 * @param milliseconds duration
 * @param signal abort signal
 */
async function sleepUnlessAborted(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/**
 * Milliseconds a `retry-after` header asks to wait, in seconds or as an http date
 *
 * @param header value of the header
 * @param now current time
 */
export function parseRetryAfter(header: string | undefined, now = Date.now()): number | undefined {
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Size of a request as sent to the model, which `maxPromptBytes` bounds
 *
 * @param prompt conversation
 * @param tools offered tools
 */
export function requestBytes(prompt: CompletionPrompt, tools: ToolDefinition[]): number {
  return Buffer.byteLength(JSON.stringify({prompt, tools}));
}

/**
 * `complete` over the Anthropic Messages API, with a plain `fetch` and no SDK. Rate limits, overloads, server errors
 * and connection errors are retried with exponential backoff and jitter, honouring `retry-after`. The signal of the
 * call aborts the request and the waits between retries.
 *
 * @param apiKey Anthropic API key, e.g. `ANTHROPIC_API_KEY`
 * @param options base url, fetch and retries
 */
export function createAnthropicComplete(apiKey: string, options: AnthropicCompleteOptions = {}): Complete {
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const fetchImplementation = options.fetch ?? fetch;
  const maxRetries = options.maxRetries ?? 4;
  const sleep = options.sleep ?? sleepUnlessAborted;
  const random = options.random ?? Math.random;
  return async (prompt, {model, maxTokens, tools, signal}) => {
    // Opus 5 can decline a request, in which case the API retries it on a fallback model within the same call
    const fallback = model === defaultModel;
    const body = JSON.stringify({
      model,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      max_tokens: maxTokens,
      system: prompt.system,
      messages: prompt.messages,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      tools: tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.inputSchema})),
      ...(fallback ? {fallbacks: 'default'} : {}),
    });

    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let response: Response | undefined;
      let failure: string;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await fetchImplementation(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            ...(fallback ? {'anthropic-beta': 'server-side-fallback-2026-07-01'} : {}),
          },
          body,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutInMilliseconds)]) : AbortSignal.timeout(requestTimeoutInMilliseconds),
        });
      } catch (error: unknown) {
        // The caller gave up, e.g. the time budget is spent
        if (signal?.aborted) {
          throw error;
        }

        failure = `connection failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (response?.ok) {
        // eslint-disable-next-line no-await-in-loop
        const result = await response.json() as {content?: ContentBlock[]; stop_reason?: string};
        return {content: result.content ?? [], stopReason: result.stop_reason ?? 'end_turn'};
      }

      if (response) {
        // The body names the error, never the key
        // eslint-disable-next-line no-await-in-loop
        const message = await response.text();
        failure = `Anthropic API responded ${response.status}: ${message.slice(0, 300)}`;
        if (!retryableStatus(response.status)) {
          throw new Error(failure);
        }
      }

      if (attempt >= maxRetries) {
        throw new Error(`${failure!} (after ${attempt + 1} attempts)`);
      }

      const backoff = Math.min(maxRetryDelayInMilliseconds, 1000 * (2 ** attempt)) * (0.5 + (random() / 2));
      const retryAfter = parseRetryAfter(response?.headers.get('retry-after') ?? undefined);
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(maxRetryDelayInMilliseconds, retryAfter ?? backoff), signal);
    }
  };
}
