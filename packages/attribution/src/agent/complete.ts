/* eslint-disable @typescript-eslint/member-ordering */
/**
 * Content block of a message, in the shape of the Anthropic Messages API
 */
export type ContentBlock =
  | {type: 'text'; text: string}
  | {type: 'tool_use'; id: string; name: string; input: unknown}
  | {type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean}
  | {type: string; [key: string]: unknown};
/* eslint-enable @typescript-eslint/member-ordering */

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
 * Tool the model can call, with the JSON schema of its input
 */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Options of a model call
 */
export type CompleteOptions = {
  model: string;
  maxTokens: number;
  tools: ToolDefinition[];
  signal?: AbortSignal;
};

/**
 * Answer of the model: its content blocks and why it stopped, e.g. `tool_use` or `end_turn`
 */
export type CompletionResponse = {
  content: ContentBlock[];
  stopReason: string;
};

/**
 * One call of the model. Injected, so tests and other providers can replace the default HTTP call.
 */
export type Complete = (prompt: CompletionPrompt, options: CompleteOptions) => Promise<CompletionResponse>;

/**
 * Model of the default call, overridden by `ATTRIBUTION_MODEL`
 */
export const defaultModel = 'claude-opus-5';

/**
 * Options of the default model call
 */
export type AnthropicCompleteOptions = {
  apiKey: string;

  /**
   * Defaults to `https://api.anthropic.com`
   */
  baseUrl?: string;

  /**
   * Milliseconds per request. Defaults to 120 s.
   */
  timeoutMs?: number;

  /**
   * Milliseconds before the one retry on 429 and 5xx, unless the answer says otherwise. Defaults to 2 s.
   */
  retryDelayMs?: number;

  /**
   * Defaults to the global fetch
   */
  fetch?: typeof fetch;
};

/**
 * Wait, unless aborted
 *
 * @param ms milliseconds
 * @param signal abort signal
 */
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, {once: true});
  });
}

/**
 * Default model call: one POST to the Anthropic Messages API over fetch, with a timeout per request and one retry on
 * 429 and 5xx. No SDK, and the key is only sent to the API.
 *
 * @param options key, endpoint and retry settings
 */
export function createAnthropicComplete(options: AnthropicCompleteOptions): Complete {
  const fetchImplementation = options.fetch ?? fetch;
  const url = `${(options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
  return async (prompt, completeOptions) => {
    /* eslint-disable @typescript-eslint/naming-convention */
    const body = JSON.stringify({
      model: completeOptions.model,
      max_tokens: completeOptions.maxTokens,
      system: prompt.system,
      messages: prompt.messages,
      tools: completeOptions.tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.inputSchema})),
    });
    const headers = {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    for (let attempt = 0; ; attempt++) {
      const signals = [AbortSignal.timeout(options.timeoutMs ?? 120_000), completeOptions.signal].filter((signal): signal is AbortSignal => signal !== undefined);
      // eslint-disable-next-line no-await-in-loop
      const response = await fetchImplementation(url, {
        method: 'POST', headers, body, signal: AbortSignal.any(signals),
      });
      if (response.ok) {
        // eslint-disable-next-line no-await-in-loop
        const json = await response.json() as {content?: ContentBlock[]; stop_reason?: string};
        return {content: json.content ?? [], stopReason: json.stop_reason ?? 'end_turn'};
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= 1) {
        let text = '';
        try {
          // eslint-disable-next-line no-await-in-loop
          text = await response.text();
        } catch {}

        // Only the error message of the API, never the request
        const message = /"message"\s*:\s*"([^"]{0,300})/.exec(text)?.[1] ?? response.statusText;
        throw new Error(`The Messages API answered ${response.status}: ${message}`);
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      // eslint-disable-next-line no-await-in-loop
      await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : options.retryDelayMs ?? 2000, completeOptions.signal);
    }
  };
}

/**
 * Model call of the attribution: the injected one, else the Messages API if `ANTHROPIC_API_KEY` is set, else none
 * (`no-agent`)
 *
 * @param environment environment variables
 * @param injected injected model call
 */
export function resolveComplete(environment: Record<string, string | undefined>, injected?: Complete): Complete | undefined {
  if (injected) {
    return injected;
  }

  const apiKey = environment.ANTHROPIC_API_KEY;
  return apiKey ? createAnthropicComplete({apiKey, baseUrl: environment.ANTHROPIC_BASE_URL}) : undefined;
}
