import {
  createTool,
} from '@mastra/core/tools';
import {
  z,
} from 'zod';
import {
  fitWithinBytes,
} from '../analysis/bundle.js';
import {
  parseTopClasses,
} from '../analysis/heap.js';
import type {
  AttributionContext,
} from './context.js';

const entityKeySchema = z.object({
  entityKey: z.string().describe('entityKey of a regression, as listed by read_bundle'),
});

const submitVerdictSchema = z.object({
  entityKey: z.string().describe('entityKey of the regression'),
  culprits: z.array(z.object({
    file: z.string().describe('Changed file, relative to the repository root, as listed in changedFiles'),
    line: z.number().int().positive().describe('1-based line inside an added range of that file'),
    basis: z.enum(['cpu', 'heap']).optional().describe('cpu: own self time of a function on the line; heap: closure on the retainer path of grown objects'),
    rationale: z.string().max(300).optional().describe('Short reason, from the tool results'),
    confidence: z.number().optional().describe('Ignored: the confidence is computed from the evidence'),
  })).max(5).describe('Culprits on changed lines, the one that explains most of the regression first; empty if none does'),
});

/**
 * Byte budget of one tool result: a quarter of the request budget
 *
 * @param context attribution context
 */
function resultBudget(context: AttributionContext): number {
  return Math.floor(context.maxPromptBytes / 4);
}

/**
 * Tools of the attribution agent, declared with Mastra. They return the bounded index of a run only: metrics,
 * changed ranges, function and class names, sizes, paths and lines. Never the content of a trace or a heap snapshot.
 *
 * @param context state of the attribution
 */
function buildTools(context: AttributionContext) {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    read_bundle: createTool({
      id: 'read_bundle',
      description: 'Regressions of the run with their increased metrics and available artifacts, and the line ranges added since the baseline commit.',
      inputSchema: z.object({}),
      async execute() {
        const {bundle} = context;
        return fitWithinBytes(bundle.changedFiles, changedFiles => ({
          run: {commit: bundle.run.commit, branch: bundle.run.branch, baselineCommit: bundle.run.baselineCommit},
          comparison: bundle.comparison?.status,
          regressions: bundle.regressions.map(regression => ({
            entityKey: regression.entityKey,
            name: regression.name,
            status: regression.status,
            changes: regression.changes.slice(0, 6).map(change => ({
              metric: change.metric, unit: change.unit, baseline: change.baselineMedian, current: change.current, relativeChange: change.relativeChange, zScore: change.zScore,
            })),
            hasTrace: regression.traceFile !== undefined,
            hasHeapSnapshot: regression.heapDiffFile !== undefined,
            topAddedClasses: parseTopClasses(regression.heapDiffTopClasses).slice(0, 5),
            ...(regression.artifactReason ? {artifactReason: regression.artifactReason} : {}),
          })),
          changedFiles: changedFiles.map(file => ({file: file.file, addedRanges: file.addedRanges.slice(0, 20)})),
        }), resultBudget(context), () => 0).value;
      },
    }),
    trace_self_time: createTool({
      id: 'trace_self_time',
      description: 'Functions with the most self time in the trace of a regression, with the 1-based lines their samples hit.',
      inputSchema: entityKeySchema,
      async execute({entityKey}) {
        const {result, problem} = await context.analyzer.trace(entityKey);
        if (!result) {
          return {problem};
        }

        // The lowest self time is dropped first
        return fitWithinBytes(result.functions, functions => ({totalSelfTime: result.totalSelfTime, functions}), resultBudget(context), (a, b) => b.selfTime - a.selfTime).value;
      },
    }),
    heap_growth: createTool({
      id: 'heap_growth',
      description: 'Classes added during a regression, the most common retainer path and dominator of their newest objects, and the closures (url and line) on those paths, deepest first.',
      inputSchema: entityKeySchema,
      async execute({entityKey}) {
        const {result, problem} = await context.analyzer.heap(entityKey);
        if (!result) {
          return {problem};
        }

        // The lowest growth is dropped first
        return fitWithinBytes(result.classes.map(entry => ({...entry, frames: entry.frames.slice(0, 8)})), classes => ({classes}), resultBudget(context), (a, b) => b.selfSize - a.selfSize).value;
      },
    }),
    attribute_to_hunks: createTool({
      id: 'attribute_to_hunks',
      description: 'Candidates of a regression inside the changed hunks, from the trace and the heap snapshot, with their evidence. Findings outside of the changed hunks are listed as evidence only and can never be culprits.',
      inputSchema: entityKeySchema,
      async execute({entityKey}) {
        const {candidates, outside, problems} = await context.analyzer.attribute(entityKey);
        return fitWithinBytes(candidates.map(({confidence, ...candidate}) => candidate), kept => ({candidates: kept, outsideOfChangedHunks: outside, problems}), resultBudget(context), (a, b) => b.share - a.share).value;
      },
    }),
    submit_verdict: createTool({
      id: 'submit_verdict',
      description: 'Submit the culprits of one regression. Culprits outside the changed hunks or without trace or heap evidence in their hunk are dropped. Submit an empty list if nothing on the changed lines explains the regression.',
      inputSchema: submitVerdictSchema,
      async execute({entityKey, culprits}) {
        const verdict = await context.submit(entityKey, culprits.map(({file, line, basis}) => ({file, line, ...(basis ? {basis} : {})})));
        return 'error' in verdict
          ? verdict
          : {accepted: verdict.culprits.map(culprit => `${culprit.file}:${culprit.line}`), dropped: verdict.dropped};
      },
    }),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

/**
 * Tools the attribution agent works with
 */
export type AttributionTools = ReturnType<typeof buildTools>;

/**
 * Tools of the attribution agent, see `buildTools`
 *
 * @param context state of the attribution
 */
export function createAttributionTools(context: AttributionContext): AttributionTools {
  return buildTools(context);
}
