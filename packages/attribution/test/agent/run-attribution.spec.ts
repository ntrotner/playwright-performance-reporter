import {
  Buffer,
} from 'node:buffer';
import {
  type AgentMessage,
  type Complete,
  type CompletionResponse,
  createAnthropicComplete,
  createAttributionContext,
  createAttributionTools,
  resolveComplete,
  runAttribution,
} from '../../src/agent/index.js';
import {
  appFile,
  createReportDir,
} from '../fixtures/report.js';

/**
 * Model that answers with the scripted responses in order, and records every prompt it got
 *
 * @param responses responses of the model, one per step
 */
function scriptedModel(responses: Array<(messages: AgentMessage[]) => CompletionResponse>): {complete: Complete; prompts: string[]} {
  const prompts: string[] = [];
  let step = 0;
  const complete: Complete = async prompt => {
    prompts.push(JSON.stringify(prompt));
    const respond = responses[Math.min(step++, responses.length - 1)];
    return respond(prompt.messages);
  };

  return {complete, prompts};
}

const toolUse = (id: string, name: string, input: unknown) => ({
  type: 'tool_use', id, name, input,
});

describe('attribution agent', () => {
  const setup = () => {
    const {dir, bundle} = createReportDir();
    const context = createAttributionContext({bundle, bundleDir: dir, maxPromptBytes: 200_000});
    return {context, tools: createAttributionTools(context), bundle};
  };

  it('runs the tools the model calls and records its verdict, validated against the changed hunks', async () => {
    const {context, tools, bundle} = setup();
    const entityKey = 'case1|Render rows|0';
    const {complete, prompts} = scriptedModel([
      () => ({stopReason: 'tool_use', content: [toolUse('1', 'read_bundle', {}), toolUse('2', 'trace_self_time', {entityKey}), toolUse('3', 'attribute_to_hunks', {entityKey})]}),
      () => ({
        stopReason: 'tool_use',
        content: [toolUse('4', 'submit_verdict', {
          entityKey,
          culprits: [
            // The agent's own confidence is ignored
            {
              file: appFile, line: 55, basis: 'cpu', confidence: 0.01,
            },
            // Outside of the changed hunks: dropped
            {
              file: 'vendor/lib.js', line: 3, basis: 'cpu', confidence: 1,
            },
          ],
        })],
      }),
      () => ({stopReason: 'end_turn', content: [{type: 'text', text: 'Done'}]}),
    ]);

    const run = await runAttribution({
      bundle, tools, complete, maxSteps: 8,
    });

    expect(run).toMatchObject({steps: 3});
    expect(run.stopReason).toBeUndefined();
    const verdict = context.verdicts.get(entityKey)!;
    expect(verdict.culprits.map(culprit => [culprit.file, culprit.line, culprit.basis, culprit.confidence])).toEqual([[appFile, 55, 'cpu', 'high']]);
    expect(verdict.dropped).toEqual([expect.objectContaining({file: 'vendor/lib.js', line: 3})]);
    // The model saw function names and paths, never the trace itself
    expect(prompts[1]).toContain('heavyRender');
    expect(prompts.join('')).not.toContain('ProfileChunk');
  });

  it('stops after maxSteps model calls', async () => {
    const {tools, bundle} = setup();
    let calls = 0;
    const complete: Complete = async () => {
      calls++;
      return {stopReason: 'tool_use', content: [toolUse(String(calls), 'read_bundle', {})]};
    };

    const run = await runAttribution({
      bundle, tools, complete, maxSteps: 3,
    });

    expect(calls).toBe(3);
    expect(run.stopReason).toContain('maxSteps (3)');
  });

  it('answers invalid tool input with an error result instead of throwing', async () => {
    const {tools, bundle} = setup();
    const {complete, prompts} = scriptedModel([
      () => ({stopReason: 'tool_use', content: [toolUse('1', 'trace_self_time', {entityKey: 5}), toolUse('2', 'no_such_tool', {})]}),
      () => ({stopReason: 'end_turn', content: []}),
    ]);

    await runAttribution({bundle, tools, complete});

    expect(prompts[1]).toContain('"is_error":true');
    expect(prompts[1]).toContain('Unknown tool no_such_tool');
  });

  it('bounds every request by maxPromptBytes', async () => {
    const {dir, bundle} = createReportDir();
    const context = createAttributionContext({bundle, bundleDir: dir, maxPromptBytes: 6000});
    const {complete, prompts} = scriptedModel([
      () => ({stopReason: 'tool_use', content: [toolUse('1', 'read_bundle', {}), toolUse('2', 'trace_self_time', {entityKey: 'case1|Render rows|0'})]}),
      () => ({stopReason: 'end_turn', content: []}),
    ]);

    const run = await runAttribution({
      bundle, tools: createAttributionTools(context), complete, maxPromptBytes: 6000,
    });

    expect(Math.max(...prompts.map(prompt => Buffer.byteLength(prompt)))).toBeLessThanOrEqual(6000);
    expect(run.steps).toBe(2);
    expect(prompts[1]).toContain('truncated to fit maxPromptBytes');
  });
});

/* eslint-disable @typescript-eslint/naming-convention -- names of the environment and of the Messages API */
describe('model call', () => {
  it('needs an api key or an injected complete, otherwise there is no agent', () => {
    const injected: Complete = async () => ({stopReason: 'end_turn', content: []});

    expect(resolveComplete({})).toBeUndefined();
    expect(resolveComplete({}, injected)).toBe(injected);
    expect(resolveComplete({ANTHROPIC_API_KEY: 'key'})).toBeDefined();
  });

  it('posts to the Messages API and retries once on an overloaded or rate limited answer', async () => {
    const requests: Array<{url: string; init: RequestInit}> = [];
    const answers = [
      new Response('{}', {status: 529}),
      Response.json({
        stop_reason: 'tool_use', content: [{
          type: 'tool_use', id: 't', name: 'read_bundle', input: {},
        }],
      }),
    ];
    const complete = createAnthropicComplete({
      apiKey: 'test-key',
      retryDelayMs: 0,
      async fetch(url, init) {
        requests.push({url: url as string, init: init!});
        return answers.shift()!;
      },
    });

    const response = await complete({system: 'system', messages: [{role: 'user', content: 'go'}]}, {model: 'claude-opus-5', maxTokens: 100, tools: [{name: 'read_bundle', description: 'd', inputSchema: {type: 'object'}}]});

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0].init.headers).toMatchObject({'x-api-key': 'test-key', 'anthropic-version': '2023-06-01'});
    expect(JSON.parse(requests[0].init.body as string)).toMatchObject({
      model: 'claude-opus-5', max_tokens: 100, system: 'system', tools: [{name: 'read_bundle', input_schema: {type: 'object'}}],
    });
    expect(response).toEqual({
      stopReason: 'tool_use', content: [{
        type: 'tool_use', id: 't', name: 'read_bundle', input: {},
      }],
    });
  });

  it('fails after the retry, and on a client error at once', async () => {
    let calls = 0;
    const failing = (status: number) => createAnthropicComplete({
      apiKey: 'k',
      retryDelayMs: 0,
      async fetch() {
        calls++;
        return new Response('{"error":{"message":"nope"}}', {status});
      },
    });
    const prompt = {system: 's', messages: [{role: 'user' as const, content: 'go'}]};
    const options = {model: 'm', maxTokens: 1, tools: []};

    await expect(failing(500)(prompt, options)).rejects.toThrow('500');
    expect(calls).toBe(2);
    calls = 0;
    await expect(failing(400)(prompt, options)).rejects.toThrow('400');
    expect(calls).toBe(1);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
