import {
  Agent,
} from '@mastra/core/agent';
import {
  z,
} from 'zod';
import {
  defaultCaps,
  promptBytes,
} from '../analysis/bundle.js';
import type {
  AttributionBundle,
} from '../types.js';
import {
  type AgentMessage,
  type Complete,
  type CompletionPrompt,
  type ContentBlock,
  defaultModel,
  type ToolDefinition,
} from './complete.js';
import type {
  AttributionTools,
} from './tools.js';

/**
 * Input of the agent seam
 */
export type RunAttributionOptions = {
  bundle: AttributionBundle;
  tools: AttributionTools;
  complete: Complete;

  /**
   * Maximum model calls. Defaults to 8.
   */
  maxSteps?: number;

  /**
   * Maximum size of a request, in bytes. Defaults to 200 000.
   */
  maxPromptBytes?: number;

  /**
   * Defaults to `claude-opus-5`
   */
  model?: string;

  /**
   * Wall-clock milliseconds of the whole loop. Defaults to 4 minutes, so the attribution step stays under 5.
   */
  timeBudgetMs?: number;
};

/**
 * What the agent did: its model calls, and why it stopped early, if it did
 */
export type AttributionRun = {
  steps: number;
  stopReason?: string;
};

/**
 * The seam of the agent: works through the regressions with the tools and submits a verdict per regression with
 * `submit_verdict`. Tests replace it with a scripted agent.
 */
export type RunAttribution = (options: RunAttributionOptions) => Promise<AttributionRun>;

export const systemPrompt = `You attribute performance regressions of a Playwright test run to the lines of code that changed since the baseline commit.

Tools:
- read_bundle: the regressions with their increased metrics, and the added line ranges per changed file.
- trace_self_time: functions with the most self time in the trace of a regression, and the lines their samples hit.
- heap_growth: classes added during a regression, their retainer paths and the closures on them.
- attribute_to_hunks: candidates inside the changed hunks with their evidence.
- submit_verdict: your culprits for one regression.

Rules:
- Submit one verdict per regression, the culprit that explains most of the regression first.
- A culprit is always on a changed line. CPU: the function's own self time is spent on that line. Heap: a closure on the retainer path of the grown objects is defined there.
- Culprits without that evidence are dropped. If nothing on the changed lines explains a regression, submit an empty list.
- The confidence is computed from the evidence; don't estimate it.
- Stop once every regression has a verdict.`;

/**
 * Mastra agent that declares the instructions and the tools. Its own model routing is never used: the loop below
 * drives the model through the injected `complete`.
 *
 * @param tools tools of the attribution
 * @param model model name
 */
export function createAttributionAgent(tools: AttributionTools, model: string): Agent {
  return new Agent({
    id: 'performance-attribution', name: 'Performance attribution', instructions: systemPrompt, model: `anthropic/${model}`, tools,
  });
}

/**
 * A tool as declared with Mastra's `createTool`
 */
type DeclaredTool = {id: string; description: string; inputSchema?: unknown; execute?: (input: unknown, context: unknown) => Promise<unknown>};

/**
 * Tool definitions for the model, from the zod schemas of the tools
 *
 * @param tools declared tools
 */
function describeTools(tools: Record<string, DeclaredTool>): ToolDefinition[] {
  return Object.values(tools).map(tool => {
    const {$schema, ...inputSchema} = z.toJSONSchema(tool.inputSchema as z.ZodType) as Record<string, unknown>;
    return {name: tool.id, description: tool.description, inputSchema};
  });
}

/**
 * Run a tool the model called, never throwing: invalid input and failures are error results
 *
 * @param tools declared tools
 * @param call tool call of the model
 * @param call.name tool name
 * @param call.input tool input
 */
async function runTool(tools: Record<string, DeclaredTool>, call: {name: string; input: unknown}): Promise<{content: string; isError: boolean}> {
  const tool = tools[call.name];
  if (!tool?.execute) {
    return {content: `Unknown tool ${call.name}`, isError: true};
  }

  try {
    const result = await tool.execute(call.input ?? {}, {});
    const isError = typeof result === 'object' && result !== null && (result as {error?: unknown}).error !== undefined && (result as {error?: unknown}).error !== false;
    return {content: JSON.stringify(result ?? null), isError};
  } catch (error) {
    return {content: error instanceof Error ? error.message : String(error), isError: true};
  }
}

/**
 * Bytes a tool result block adds to a request besides its content
 */
const toolResultOverhead = 120;

/**
 * Shorten a text to a byte budget, marking the cut
 *
 * @param text text
 * @param maxBytes byte budget
 */
function truncate(text: string, maxBytes: number): string {
  if (promptBytes(text) <= maxBytes) {
    return text;
  }

  const marker = '…(truncated to fit maxPromptBytes)';
  let kept = text.slice(0, Math.max(0, maxBytes - marker.length));
  while (kept.length > 0 && promptBytes(kept + marker) > maxBytes) {
    kept = kept.slice(0, Math.floor(kept.length * 0.9));
  }

  return kept.length > 0 ? `${kept}${marker}` : '(omitted to fit maxPromptBytes)';
}

/**
 * The agent as a hand-driven tool-calling loop over the injected `complete`: the model calls the tools until it stops
 * on its own, or the step, byte or time limit is reached. No request exceeds `maxPromptBytes`.
 *
 * @param options bundle, tools, model call and limits
 */
export const runAttribution: RunAttribution = async options => {
  const model = options.model ?? defaultModel;
  const maxSteps = options.maxSteps ?? 8;
  const maxPromptBytes = options.maxPromptBytes ?? defaultCaps.maxPromptBytes;
  const agent = createAttributionAgent(options.tools, model);
  const tools = await agent.listTools() as unknown as Record<string, DeclaredTool>;
  const definitions = describeTools(tools);
  const messages: AgentMessage[] = [{
    role: 'user',
    content: `Attribute the ${options.bundle.regressions.length} regression(s) of commit ${options.bundle.run.commit ?? 'unknown'} against baseline ${options.bundle.run.baselineCommit ?? 'unknown'}. Start with read_bundle.`,
  }];
  const prompt: CompletionPrompt = {system: systemPrompt, messages};
  const requestBytes = () => promptBytes({...prompt, tools: definitions});
  const timeBudgetMs = options.timeBudgetMs ?? 4 * 60 * 1000;
  const deadline = Date.now() + timeBudgetMs;

  for (let step = 0; step < maxSteps; step++) {
    if (requestBytes() > maxPromptBytes) {
      return {steps: step, stopReason: `the conversation reached maxPromptBytes (${maxPromptBytes})`};
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {steps: step, stopReason: `the agent reached its time budget (${Math.round(timeBudgetMs / 1000)} s)`};
    }

    // eslint-disable-next-line no-await-in-loop
    const response = await options.complete(prompt, {
      model, maxTokens: 16_000, tools: definitions, signal: AbortSignal.timeout(remaining),
    });
    // The whole answer goes back, including thinking blocks
    messages.push({role: 'assistant', content: response.content});
    const calls = response.content.filter((block): block is {type: 'tool_use'; id: string; name: string; input: unknown} => block.type === 'tool_use');
    if (response.stopReason !== 'tool_use' || calls.length === 0) {
      return {steps: step + 1, ...(['refusal', 'max_tokens'].includes(response.stopReason) ? {stopReason: `the model stopped with ${response.stopReason}`} : {})};
    }

    const results: Array<{id: string; content: string; isError: boolean}> = [];
    for (const call of calls) {
      // eslint-disable-next-line no-await-in-loop
      results.push({id: call.id, ...await runTool(tools, call)});
    }

    // Share what is left of the budget among the results of this turn
    const share = Math.max(0, Math.floor((maxPromptBytes - requestBytes() - (results.length * toolResultOverhead)) / results.length));
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

  return {steps: maxSteps, stopReason: `the agent reached maxSteps (${maxSteps})`};
};
