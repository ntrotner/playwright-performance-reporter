import {
  createTool,
} from '@mastra/core/tools';
import {
  z,
} from 'zod';
import {
  parseTopClasses,
} from '../analysis/heap-growth.js';
import type {
  AttributionContext,
} from './context.js';

const entityKeySchema = z.object({
  entityKey: z.string().describe('entityKey of a regression, as listed by read_bundle'),
});

const submitVerdictSchema = z.object({
  entityKey: z.string().describe('entityKey of the regression'),
  culprits: z.array(z.object({
    file: z.string().describe('Changed file, relative to the repository root, as listed in the hunks'),
    line: z.number().int().positive().describe('1-based line inside a changed hunk'),
    endLine: z.number().int().positive().optional(),
    basis: z.enum(['cpu', 'heap']).describe('cpu: own self time of a function on the line; heap: closure or scope variable on the retainer path of grown objects'),
    symbol: z.string().optional().describe('Function or class'),
    evidence: z.array(z.string()).max(5).optional().describe('Short facts from the tool results that support the culprit'),
  })).max(5).describe('Culprits on changed lines, the one that explains most of the regression first; empty if none does'),
});

/**
 * Tools of the attribution agent. They only return the bounded index of a run: metrics, changed lines, function names,
 * class names, sizes and source locations. Never the content of a trace or a heap snapshot.
 *
 * @param context state of the attribution
 */
function buildTools(context: AttributionContext) {
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    read_bundle: createTool({
      id: 'read_bundle',
      description: 'Regressions of the run with their increased metrics and available artifacts, and the lines that changed since the baseline commit.',
      inputSchema: z.object({}),
      async execute() {
        const {bundle} = context;
        return {
          run: {commit: bundle.run.commit, branch: bundle.run.branch, baselineCommit: bundle.run.baselineCommit},
          ...(bundle.unresolved ? {unresolved: bundle.unresolved} : {}),
          omitted: bundle.omitted,
          hunks: bundle.hunks.map(hunk => ({file: hunk.file, addedRanges: hunk.addedRanges.slice(0, 20)})),
          regressions: bundle.regressions.map(regression => ({
            entityKey: regression.entityKey,
            name: regression.name,
            status: regression.status,
            basis: regression.basis,
            changes: regression.changes.slice(0, 6).map(change => ({
              metric: change.metric, unit: change.unit, baseline: change.baselineMedian, current: change.current, relativeChange: change.relativeChange, zScore: change.zScore,
            })),
            hasTrace: regression.artifacts.traceFile !== undefined,
            hasHeapSnapshot: regression.artifacts.heapDiffFile !== undefined,
            topAddedClasses: parseTopClasses(regression.heapDiffTopClasses).slice(0, 5),
            ...(regression.reason ? {reason: regression.reason} : {}),
          })),
        };
      },
    }),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    trace_self_time: createTool({
      id: 'trace_self_time',
      description: 'Functions with the most self time in the trace of a regression, with the lines their samples hit (1-based).',
      inputSchema: entityKeySchema,
      async execute({entityKey}) {
        const {result, problem} = await context.traceSelfTime(entityKey);
        // The analysis checks every line against the changed lines, the model sees the hottest ones
        return result
          ? {totalSelfTime: result.totalSelfTime, functions: result.functions.slice(0, 15).map(fn => ({...fn, lines: fn.lines.slice(0, 5)}))}
          : {problem};
      },
    }),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    heap_growth: createTool({
      id: 'heap_growth',
      description: 'Classes added during a regression, the most common retainer path of their newest objects, and the closures (file and line) and scope variables on those paths.',
      inputSchema: entityKeySchema,
      async execute({entityKey}) {
        const {result, problem} = await context.heapGrowth(entityKey);
        return result
          ? {classes: result.classes.map(entry => ({...entry, frames: entry.frames.slice(0, 8)}))}
          : {problem};
      },
    }),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    attribute_to_hunks: createTool({
      id: 'attribute_to_hunks',
      description: 'Candidates of a regression on the changed lines, validated against the trace and the heap snapshot, with their evidence. Findings outside of the changed lines are listed as evidence only.',
      inputSchema: entityKeySchema,
      async execute({entityKey}) {
        const {culprits, evidence, problems} = await context.attribution(entityKey);
        return {
          candidates: culprits.slice(0, 8).map(({confidence, ...candidate}) => candidate),
          outsideOfChangedLines: evidence.slice(0, 8),
          problems,
        };
      },
    }),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    submit_verdict: createTool({
      id: 'submit_verdict',
      description: 'Submit the culprits of one regression. Culprits that are not backed by the evidence on a changed line are dropped. Submit an empty list if nothing on the changed lines explains the regression.',
      inputSchema: submitVerdictSchema,
      async execute({entityKey, culprits}) {
        return context.submit(entityKey, culprits);
      },
    }),
  };
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
