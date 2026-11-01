# playwright-performance-attribution

Attributes the performance regressions of a [playwright-performance-reporter](../../README.md) run to the changed
hunks of the commit range: which change made the UI slower or leakier, from the run's traces and heap snapshots.

Not published yet (`private`, version `0.0.0-development`): it lives in this repository with its own lockfile and is
installed separately, like a future published package. Node >= 22.

It has two halves:

- **`attributionPresenter`**, on the test path, only hands off. After the last test it writes one
  `attribution-bundle.json`: the regressions of the comparison, the paths of their traces and heap snapshots, and the
  line ranges added since the baseline commit, or why they are unknown. It never opens a trace or a `.heapsnapshot`,
  never calls a model, holds no credentials and never throws.
- **`performance-attribution attribute <report-dir>`**, offline after the run, does the work: trace self time per
  function and line, heap class growth to retainer path to source, an agent that picks culprits, and validation of every
  culprit against the changed hunks. It writes `attribution.md` and appends it to `$GITHUB_STEP_SUMMARY`.

## Setup

Build the reporter in the repository root first: the package only imports its types (`import type`), resolved from
`../../lib` through the `file:../..` dev dependency. `npm test`, `npm run typecheck` and `npm run build` build it if
`lib/` is missing.

```bash
npm ci && npm run build             # repository root
cd packages/attribution && npm ci && npm run build
```

Register the presenter after the comparison presenter it reads, with the same `historyDir`:

```ts
import {nativeChromiumObservers, nativePresenters} from 'playwright-performance-reporter';
import {attributionPresenter} from 'playwright-performance-attribution';

const historyDir = './performance-history';
const comparison = new nativePresenters.comparisonPresenter({historyDir, outputDir: './report'});

presenters: [
  comparison,
  new attributionPresenter({outputDir: './report', comparison, historyDir}),
],
browsers: {
  chromium: {
    onTestStep: {
      metrics: [
        new nativeChromiumObservers.allPerformanceMetrics(),
        // Heap snapshots and traces are what the CLI attributes from
        new nativeChromiumObservers.heapDiff({topClasses: 50, writeSnapshots: true}),
        new nativeChromiumObservers.traceCapture(),
      ],
    },
  },
},
```

| Option       | Type                  | Default                     | Description |
|--------------|-----------------------|-----------------------------|-------------|
| `outputDir`  | `string`              | none (required)             | Folder of the bundle, created if missing. |
| `outputFile` | `string`              | `'attribution-bundle.json'` | File name of the bundle. |
| `comparison` | `ComparisonPresenter` | none (required)             | The comparison presenter of the same run. |
| `historyDir` | `string`              | none                        | `historyDir` of the comparison presenter. Its report only names the baseline runs; their commit is in these files. Without it the bundle says `no-revision-metadata`. |
| `repoDir`    | `string`              | `process.cwd()`             | Directory inside the git repository of the code under test. |

The run needs a commit in its metadata (the reporter records `git rev-parse HEAD` or the CI commit) and in the
baseline runs of its history.

## Bundle

`close()` resolves, in order: the run metadata, the baseline commit (the newest baseline run with a commit other than
the run's), that the baseline is an ancestor, then one `git diff --unified=0 <baseline>...<commit>` (2 s timeout per
git call). A failure stops the next step, keeps the regressions and leaves `changedFiles` empty. The bundle is written
once, atomically (`<file>.tmp-<pid>`, then `rename`).

| Field          | Content |
|----------------|---------|
| `status`       | `ok`, `no-regressions`, `no-comparison`, `no-revision-metadata`, `git-unavailable`, `baseline-not-an-ancestor` or `error` |
| `message`      | Why, in words. The CLI reproduces it verbatim. |
| `run`          | `{commit, branch, baselineCommit, startedAt}` |
| `comparison`   | `{status, message}` of the comparison report |
| `settings`     | The comparison settings the regressions were judged against (`recentRuns`, `baselineWindow`, `zScoreThreshold`, `minBaselineRuns`, ...) |
| `regressions`  | Every test and step with status `regressed` or `mixed`, reduced to its `increased` changes, with `traceFile` / `heapDiffFile` as `{file, absoluteFile}`, the recorded `heapDiffTopClasses`, or `artifactReason: 'no-artifact'` |
| `changedFiles` | `[{file, addedRanges: [{start, end}]}]`, repository-relative, 1-based and inclusive |

## CLI

```bash
performance-attribution attribute <report-dir> [--bundle <file>] [--out <file>] [--json <file>] \
  [--max-regressions 25] [--max-changed-files 200] [--max-prompt-bytes 200000]
# or, from this package
npm run attribute -- <report-dir>
```

- Caps the bundle deterministically: regressions with an artifact and the largest change first; changed files that can
  run in a page first, then in diff order. The result reports how many were left out.
- Without `ANTHROPIC_API_KEY` the result is `no-agent`: the evidence inside the changed hunks is still listed, marked
  unverified. `ATTRIBUTION_MODEL` overrides the model (default `claude-opus-5`).
- Writes `attribution.md` next to the bundle (or `--out`), appends it to `$GITHUB_STEP_SUMMARY` if set, and with
  `--json` the machine-readable result. It never posts anywhere.
- Exit code 2 only for a missing or malformed bundle, 1 for wrong arguments (unknown command, a cap that is no count).
  `no-agent`, `no-culprit`, low confidence and internal errors exit 0, the errors logged to stderr.
- The bin runs itself with `--max-old-space-size=8192` for large heap snapshots, like the `attribute` and `eval`
  scripts.

### How a culprit is found

- **CPU**: `@paulirish/trace_engine` parses the gzip or plain trace of `traceCapture`; self time is summed per
  function and per sampled line (top 25 functions). A line inside a changed hunk is a candidate.
- **Heap**: memlab loads the run's own snapshot only. The grown classes come from `heapDiffTopClasses`; for the newest
  objects of each class that no other sampled object dominates (`getDominatorNodes`), the shortest retainer path is
  followed. The deepest closure on the path that is defined inside a changed hunk is the candidate.
- **Mapping**: a script url matches a changed file by its exact repository path or by at least two trailing path
  segments, and only if exactly one changed file matches. Transpiled sources (`.ts`, `.vue`, ...) never match, as their
  served lines aren't the repository's; without source maps such a regression is `no-culprit`, never a guess.
- **Agent**: the tools `read_bundle`, `trace_self_time`, `heap_growth`, `attribute_to_hunks` and `submit_verdict` are
  declared with Mastra's `createTool` and an `Agent`, but the loop is driven by hand through an injected
  `complete(prompt, options)` (default: one `fetch` to the Messages API, 120 s timeout, one retry on 429/5xx) for at
  most 8 steps. Tool results carry indices, names, sizes, paths and lines, never trace or snapshot content, and every
  request stays within `maxPromptBytes` (the lowest self time and the smallest growth are dropped first).
- **Validation**: a submitted culprit is kept only if it lies inside a changed hunk and there is trace or heap evidence
  in that hunk; anything else is dropped and listed.
- **Confidence** (`src/analysis/confidence.ts`): `high` only if the culprit lies in a changed hunk, its basis explains an
  increased metric (heap metrics for heap, timing metrics for cpu), the evidence is material (>= 10% of the trace's self
  time, or on the retainer path of >= half of the sampled objects), the test or step `regressed` (not `mixed`) and the
  comparison was `ok` (not `low-confidence`). Otherwise `low`. Numbers the agent submits are ignored.

## Seeded eval

`example/seeded-regressions/` is a suite with a dependency-free `node:http` app whose pages load the app file itself as
a module, so trace and heap lines are lines of `example/seeded-regressions/app/server.mjs`. On `main` its three handlers
are efficient. Its config imports the presenter from `src/` (Playwright transpiles it), so
`cd example && npm run test:seeded-regressions` always runs the current presenter without building this package. The local branch `seeded-regressions` is a no-op base commit plus one commit that degrades them (a leak
through closures in a module-level cache, a layout per row, an array scan instead of a `Map`). It is never merged.

```bash
cd packages/attribution
npm run eval                 # needs ANTHROPIC_API_KEY and the local seeded-regressions branch
npm run eval -- --scripted   # deterministic stand-in for the model: checks the pipeline, not the prompt
```

The eval creates worktrees of `seeded-regressions~1` and `seeded-regressions`, runs the base 4 times
(`minBaselineRuns` + 1) and the head 2 times (so the median of `recentRuns: 3` is the head) into one shared history
(`PERF_HISTORY_DIR`), attributes the head's regressions and passes if the top culprit of at least 2 of 3 seeded steps
lies in its degraded handler and no culprit lies outside the changed hunks. Results stay in the printed temp folder.

## Development

| Command             | Purpose |
|---------------------|---------|
| `npm test`          | Jest (ts-jest ESM): presenter, analysis, agent and CLI seams, no network, no browser |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build`     | Compile `src/` to `lib/` |
| `npm run lint`      | xo with the root's config. **Applies fixes** |
| `npm run lint:check` | xo without fixes, as in CI |
