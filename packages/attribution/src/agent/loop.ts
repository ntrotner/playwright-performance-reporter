import {
  Buffer,
} from 'node:buffer';
import {
  z,
} from 'zod';
import type {
  CappedBundle,
} from '../analysis/bundle.js';
import {
  type AgentMessage,
  type Complete,
  type CompletionPrompt,
  type ContentBlock,
  requestBytes,
  type ToolDefinition,
} from './complete.js';
import type {
  AttributionTools,
} from './tools.js';

/**
 * The seam of the agent: works through the regressions of a bundle with the tools and submits a verdict per
 * regression with `submit_verdict`. Tests replace it with a scripted agent.
 */
export type RunAttribution = (bundle: CappedBundle, tools: AttributionTools) => Promise<void>;

/**
 * Settings of the agent loop
 */
export type AgentLoopOptions = {
  complete: Complete;
  model: string;

  /**
   * Maximum model calls
   */
  maxSteps: number;

  /**
   * Maximum size of a request to the model, in bytes
   */
  maxPromptBytes: number;

  /**
   * Wall-clock milliseconds the whole loop may take, model calls, retries and tools included. Defaults to 5 minutes.
   */
  timeBudgetMs?: number;

  /**
   * Maximum output tokens per model call. Defaults to 16000.
   */
  maxTokens?: number;

  /**
   * Receives why the loop stopped before the model finished, e.g. the step limit
   */
  onStop?: (reason: string) => void;
};

/**
 * Default wall-clock budget of the agent
 */
export const defaultTimeBudgetMs = 5 * 60 * 1000;

const systemPrompt = `You attribute performance regressions of a Playwright test run to the lines of code that changed since the baseline commit.

Tools:
- read_bundle: the regressions with their increased metrics, and the changed lines (hunks).
- trace_self_time: functions with the most self time in the trace of a regression, and the lines their samples hit.
- heap_growth: classes added during a regression, their retainer paths, and the closures and scope variables on those paths.
- attribute_to_hunks: candidates on changed lines, validated against the trace and the heap snapshot, with evidence.
- submit_verdict: your culprits for one regression.

Rules:
- Submit exactly one verdict per regression, the culprit that explains most of the regression first.
- A culprit is always on a changed line. CPU: the function's own self time is spent on that line. Heap: a frame of the retainer path of the grown objects is on that line, a closure defined there or a scope variable filled or declared there.
- Culprits without that evidence are dropped. If nothing on the changed lines explains a regression, submit an empty list.
- The confidence is computed from the evidence, do not estimate it.
- Stop once every regression has a verdict.`;

/**
 * Bytes a tool result block adds to the request besides its content
 */
const toolResultOverhead = 160;

/**
 * Shorten a text to a size in bytes, marking the cut
 *
 * @param text text
 * @param maxBytes maximum bytes
 */
function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) {
    return text;
  }

  const marker = '…(truncated to fit maxPromptBytes)';
  // JSON escaping can double the size of a character, so keep half of the budget
  return maxBytes > marker.length * 2 ? `${Buffer.from(text).subarray(0, Math.floor((maxBytes - marker.length) / 2)).toString('utf8')}${marker}` : '(omitted to fit maxPromptBytes)';
}

/**
 * Tool definitions for the model, from the zod schemas of the Mastra tools
 *
 * @param tools tools of the attribution
 */
function describeTools(tools: AttributionTools): ToolDefinition[] {
  return Object.values(tools).map(tool => {
    const {$schema, ...inputSchema} = z.toJSONSchema(tool.inputSchema as z.ZodType) as Record<string, unknown>;
    return {name: tool.id, description: tool.description, inputSchema};
  });
}

/**
 * Run a tool the model called and serialize its result
 *
 * @param tools tools of the attribution
 * @param call tool call of the model
 * @param call.name name of the tool
 * @param call.input input of the model
 */
async function runTool(tools: AttributionTools, call: {name: string; input: unknown}): Promise<{content: string; isError: boolean}> {
  const tool = (tools as Record<string, {execute?: (input: unknown, context: unknown) => Promise<unknown>}>)[call.name];
  if (!tool?.execute) {
    return {content: `Unknown tool ${call.name}`, isError: true};
  }

  try {
    const result = await tool.execute(call.input ?? {}, {});
    const isError = typeof result === 'object' && result !== null && (result as {error?: unknown}).error === true;
    return {content: JSON.stringify(result), isError};
  } catch (error) {
    return {content: error instanceof Error ? error.message : String(error), isError: true};
  }
}

/**
 * Agent as a tool-calling loop over the injected `complete`: the model calls the tools until it submitted its
 * verdicts, it stops on its own, or the step or byte limit is reached. Tool results are shortened so that no request
 * exceeds `maxPromptBytes`.
 *
 * @param options model, limits and the model call
 */
export function createAgentLoop(options: AgentLoopOptions): RunAttribution {
  return async (bundle, tools) => {
    const definitions = describeTools(tools);
    const messages: AgentMessage[] = [{
      role: 'user',
      content: `Attribute the ${bundle.regressions.length} regression(s) of commit ${bundle.run.commit ?? 'unknown'} against baseline ${bundle.run.baselineCommit ?? 'unknown'}. Start with read_bundle.`,
    }];
    const prompt: CompletionPrompt = {system: systemPrompt, messages};
    const timeBudgetMs = options.timeBudgetMs ?? defaultTimeBudgetMs;
    const deadline = Date.now() + timeBudgetMs;
    const outOfTime = `the agent reached its time budget (${Math.round(timeBudgetMs / 1000)} s)`;

    for (let step = 0; step < options.maxSteps; step++) {
      if (requestBytes(prompt, definitions) > options.maxPromptBytes) {
        options.onStop?.(`the conversation reached maxPromptBytes (${options.maxPromptBytes}) after ${step} step(s)`);
        return;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        options.onStop?.(outOfTime);
        return;
      }

      // The signal stops the call and its retries; the race also stops a call that ignores the signal
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<undefined>(resolve => {
        timer = setTimeout(() => {
          controller.abort(new Error(outOfTime));
          resolve(undefined);
        }, remaining);
      });
      let response: Awaited<ReturnType<Complete>> | undefined;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await Promise.race([
          options.complete(prompt, {
            model: options.model, maxTokens: options.maxTokens ?? 16_000, tools: definitions, signal: controller.signal,
          }),
          expired,
        ]);
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          options.onStop?.(outOfTime);
          return;
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }

      if (!response) {
        options.onStop?.(outOfTime);
        return;
      }

      // The whole answer goes back, including thinking blocks
      messages.push({role: 'assistant', content: response.content});
      const calls = response.content.filter((block): block is {type: 'tool_use'; id: string; name: string; input: unknown} => block.type === 'tool_use');
      if (response.stopReason !== 'tool_use' || calls.length === 0) {
        if (response.stopReason === 'refusal' || response.stopReason === 'max_tokens') {
          options.onStop?.(`the model stopped with ${response.stopReason}`);
        }

        return;
      }

      const results: Array<{id: string; content: string; isError: boolean}> = [];
      for (const call of calls) {
        // eslint-disable-next-line no-await-in-loop
        results.push({id: call.id, ...await runTool(tools, call)});
      }

      // Share what is left of the budget among the results of this turn
      const remainingBytes = options.maxPromptBytes - requestBytes(prompt, definitions) - (results.length * toolResultOverhead);
      const share = Math.max(0, Math.floor(remainingBytes / results.length));
      messages.push({
        role: 'user',
        content: results.map(result => ({
          type: 'tool_result',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          tool_use_id: result.id,
          content: truncate(result.content, share),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          ...(result.isError ? {is_error: true} : {}),
        }) satisfies ContentBlock),
      });
    }

    options.onStop?.(`the agent reached maxSteps (${options.maxSteps})`);
  };
}
