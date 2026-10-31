# playwright-performance-attribution

Attributes the performance regressions of a [`playwright-performance-reporter`](../../README.md) run to the lines of code that changed since the baseline: how much memory and CPU did my change cost, and where?

- **Inputs:** the regressions of `comparisonPresenter` (baseline window, median of the recent runs, robust z-score: the reporter's noise model, not a second one), the trace of `traceCapture`, the heap snapshot of `heapDiff({writeSnapshots: true})`, and the changed lines `git diff <baseline commit>...<commit>`.
- **Output:** `attribution.md`, a comment-ready table with the culprit of every regression as `file:line` inside the changed lines, its confidence, and the evidence. Also appended to the GitHub Actions job summary.

It's a package of its own so the reporter carries none of its dependencies (memlab, the DevTools trace engine, Mastra). It works in two steps:

1. **`AttributionPresenter`** (during the run, seconds): writes `performance-attribution.json`, a self-contained bundle of the regressions, the paths of their artifacts and the changed lines. It never opens an artifact, never calls a model, needs no credentials and never fails the run.
2. **`performance-attribution attribute <report-dir>`** (after the run, offline): analyzes the artifacts and lets an agent attribute every regression. Without `ANTHROPIC_API_KEY` it writes the bundle-derived report with `no-agent`.

## Install

```bash
npm install --save-dev playwright-performance-attribution
```

Requires node 22 or later, and `playwright-performance-reporter` as a peer. memlab depends on puppeteer, which downloads a browser on install that this package never uses; set `PUPPETEER_SKIP_DOWNLOAD=true` when installing (this repository does it with `.puppeteerrc.cjs`).

## Presenter

```ts
import {nativeChromiumObservers, nativePresenters, type Options} from 'playwright-performance-reporter';
import {AttributionPresenter} from 'playwright-performance-attribution';

const historyDir = './performance-history';
const comparison = new nativePresenters.comparisonPresenter({historyDir, outputDir: './'});

const options: Options = {
  deleteOnFailure: false,
  presenters: [
    comparison,
    // After the comparison presenter, as it reads its report
    // The app under test serves ./web/ of the repository at http://localhost:3000/
    new AttributionPresenter({outputDir: './', comparison, historyDir, sourceRoots: [{url: 'http://localhost:3000/', path: 'web'}]}),
  ],
  browsers: {
    chromium: {
      onTestStep: {
        metrics: [
          new nativeChromiumObservers.allPerformanceMetrics(),
          new nativeChromiumObservers.heapDiff({topClasses: 50, writeSnapshots: true}),
          new nativeChromiumObservers.traceCapture(),
        ],
      },
    },
  },
};
```

| Option       | Type                    | Default                         | Description |
|--------------|-------------------------|---------------------------------|-------------|
| `outputDir`  | `string`                | none (required)                 | Folder of the bundle, created if missing. |
| `outputFile` | `string`                | `'performance-attribution.json'` | File name of the bundle. |
| `comparison` | `ComparisonPresenter`   | none (required)                 | The comparison presenter of the same run, registered before this presenter. |
| `historyDir` | `string`                | none (required)                 | The `historyDir` of the comparison presenter, to read the commit of the baseline runs. If it contains none of the baseline runs of the comparison, the presenter warns and the bundle says so in `unresolvedDetail`. |
| `repoDir`    | `string`                | `process.cwd()`                 | Directory inside the git repository of the code under test. |
| `caps`       | `Partial<AttributionCaps>` | `{maxRegressions: 25, maxChangedFiles: 200, maxPromptBytes: 200_000}` | Defaults of the CLI, written into the bundle. The CLI enforces them. |
| `sourceRoots` | `Array<{url: string; path: string}>` | none | Where the app serves files of the repository: scripts below `url` are the files below `path` (absolute, or relative to the repository root). See [Matching scripts to changed files](#matching-scripts-to-changed-files). |

What the bundle holds:

- **Regressions:** every test and step the comparison marks `regressed` or `mixed`, with only its `increased` metrics, its `traceFile` and `heapDiffFile` as `{file, absoluteFile}` (`file` as the observer recorded it, `absoluteFile` resolved at the end of the run), and `heapDiffTopClasses`. Without an artifact, `reason: 'no-artifact'`.
- **Changed lines:** the added lines per file, with their text (up to 2000 lines per file), between the baseline commit and the commit of the current run, from `git diff <baseline>...<head> --unified=0`. The baseline commit is the newest `metadata.commit` of the baseline runs that differs from the current commit, as a re-run of the current commit can be part of the baseline. If the lines can't be resolved, `unresolved` is one of `no revision metadata`, `git unavailable` (also if the current commit is not in the checkout) or `baseline commit is not an ancestor` (also if the baseline commit is not in the checkout), and the run stays green. If every baseline run is of the current commit, or no line was added, `unresolved` is `no changes since the baseline commit` and the CLI skips the agent. `unresolvedDetail` says more, e.g. which commit is missing, which history file couldn't be read, or what git reported.
- With no regression, the bundle is still written with `note: 'no-regressions'`. Without a comparison to take regressions from (the comparison presenter failed or has no report, or its status is `no-baseline` or `invalid-current-run`), it says `note: 'comparison-unavailable'` with the reason in `noteDetail`, never that nothing regressed.

### Baseline commit and `fetch-depth`

The presenter diffs against the newest baseline commit other than the current one, so both commits have to be in the checkout. `actions/checkout` fetches a single commit by default, which yields `baseline commit is not an ancestor`. Fetch the history, or at least the baseline ref:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

The commit comes from the run metadata of the reporter (`GITHUB_SHA` in GitHub Actions, otherwise `git rev-parse HEAD`). Keep the `historyDir` between runs, e.g. in the Actions cache, as described for `comparisonPresenter`.

## CLI

```bash
npx performance-attribution attribute <report-dir> [options]
```

Reads `<report-dir>/performance-attribution.json`, writes `attribution.md` and `attribution.json` (the verdicts) next to it, and appends the markdown to `$GITHUB_STEP_SUMMARY` when it's set. It needs neither the app nor git: the changed lines are in the bundle. Artifacts are read from their `absoluteFile`, or from `file` relative to the bundle if the report moved, e.g. after downloading a CI artifact.

| Flag                      | Default                                  | Description |
|---------------------------|------------------------------------------|-------------|
| `--bundle <file>`         | `<report-dir>/performance-attribution.json` | Bundle file. |
| `--output <file>`         | `<report-dir>/attribution.md`            | Markdown file. `attribution.json` is written next to it. |
| `--model <id>`            | `$ATTRIBUTION_MODEL`, or `claude-opus-5` | Model of the agent. |
| `--max-steps <n>`         | `30`                                     | Maximum model calls. |
| `--max-regressions <n>`   | bundle, `25`                             | Regressions analyzed, in the order of the comparison report. |
| `--max-changed-files <n>` | bundle, `200`                            | Changed files considered. |
| `--max-prompt-bytes <n>`  | bundle, `200000`                         | Upper bound of every request to the model. Tool results are shortened to fit; the agent stops when the conversation reaches it. |
| `--time-budget <seconds>` | `300`                                    | Wall-clock limit of the agent, model calls and retries included. Regressions without a verdict by then are `no-agent`. |
| `--source-root <url>=<path>` |                                       | Adds a source root to those of the bundle, e.g. `http://localhost:3000/=web`. Repeatable. |
| `--no-agent`              |                                          | Skip the agent, every regression is `no-agent`. |

Environment: `ANTHROPIC_API_KEY` enables the agent, `ATTRIBUTION_MODEL` selects the model, `GITHUB_STEP_SUMMARY` receives the markdown.

The exit code is `0` for every analysis outcome, including a missing bundle, a missing or unreadable artifact and a failing agent; each becomes a stated reason in the report. If `attribution.md`, `attribution.json` or the job summary can't be written, the failure is logged, the markdown is printed to stdout, and the exit code stays `0`.

The default model call retries rate limits (429), overloads (529), server errors and failed connections up to 4 times, with exponential backoff and jitter, honouring `retry-after`. Usage errors exit with `2`. The bin runs node with `--max-old-space-size=8192`, as a large `.heapsnapshot` exceeds the default heap; set the flag yourself to choose another limit.

### Verdicts

| Status       | Meaning |
|--------------|---------|
| `attributed` | At least one culprit on the changed lines. The top-1 culprit is the first. |
| `no-culprit` | Nothing on the changed lines explains the regression, the changed lines are unknown, or the artifacts couldn't be read. The evidence says which. |
| `no-agent`   | No verdict of an agent: none ran (`--no-agent`, no `ANTHROPIC_API_KEY`), it failed or stopped before this regression (API unavailable after retries, time budget, `--max-steps`, `--max-prompt-bytes`), or it finished without analyzing this regression. The reason says which. This never claims anything about the changed lines. Once the agent finished, nothing more is analyzed, so the time budget holds. |

A culprit is only ever a changed line:

- **CPU:** the self time of a function in the trace, on the lines its samples hit. A function is a culprit only if its own self time is on changed lines; it's reported at its hottest changed line. A caller whose callee is slow is not. Every function and every sampled line is checked; only what the model sees is trimmed. A function can be a CPU culprit and a heap culprit on the same line.
- **Heap:** the classes `heapDiff` saw growing, and the shortest retainer paths of their newest objects in the snapshot. A class is attributed only if at least one frame of its retainer paths lies inside a changed hunk. Frames located in the snapshot rank first, then the deepest one, closest to the objects. Frames are:
  - a **closure** on the path, at the line it is defined, located in the snapshot;
  - a **scope variable** on the path, e.g. the module variable `cache` that holds the array of the objects. Its scope belongs to one script, so it lies on a changed line of that script that fills it (`cache.push(…)`, `cache.set(…)`, `cache[key] = …`, `cache = …`) or, failing that, declares it (`const`, `let`, `var cache`). The snapshot names the variable and its script, but not the line; the line is found by the name in the changed text, and the evidence says so.

  The retainer paths are the shortest paths to a GC root of `@memlab/core` (`utils.getSnapshotFromFile` and its path finder); `@memlab/heap-analysis` isn't needed for that, so it's not a dependency.

  Properties of objects are not frames: an object can come from any script, so a changed line that merely mentions the same name (`const items = []`, `{items: …}`, `other.items = …`) says nothing about the retainer path.

### Matching scripts to changed files

A culprit is never a guess, so a script url is matched to a changed file only like this:

1. Below a **source root** (`sourceRoots` of the presenter, or `--source-root`), a script is exactly the file the root maps it to, e.g. `http://localhost:3000/app/main.js` to `web/app/main.js`. If that file didn't change, it doesn't match anything.
2. Otherwise only scripts of the **page origin** (the main frame in the trace of the same step) and local `file://` scripts match, by the longest common path suffix of **at least two segments**, e.g. `http://localhost:3000/src/index.js` to `web/src/index.js`. A file name alone (`index.js`) is too common, and if two changed files fit equally well, none is chosen.
3. **Third-party scripts**, e.g. of a CDN, never match unless they are below a source root.
4. **Source-mapped and transpiled scripts** never match: their lines are not the lines of the repository, and source maps are not resolved. A script counts as source-mapped if its heap snapshot source ends with a `sourceMappingURL`, if the trace records a source map for it, or if it is a `.ts`, `.tsx`, `.jsx`, `.vue` or `.svelte` source. Traces only record source maps with the category `disabled-by-default-devtools.v8-source-rundown`, so add it to the `categories` of `traceCapture` to detect them in bundles. Attribution works on code that is served as it is in the repository, like the seeded app below.

Everything that doesn't match is listed as evidence, never as a culprit.

A culprit names the increased metric of its own basis it explains, e.g. `TaskDuration` for a CPU culprit; if the regression has none of that basis, e.g. a CPU culprit of a regression that only grew the heap, it names none.

The confidence (0 to 1) is computed from the evidence only, never taken from the agent: `0.6 × overlap + 0.4 × delta strength`. The overlap is the share of the sampled self time on the changed lines (CPU), or of the sampled retainer paths through the reported frame (heap). The delta strength is the mean of the relative change (100 % counts fully) and the robust z-score (10 counts fully) of the strongest increased metric.

Example output of the seeded regressions below (trimmed to the steps; the tests themselves have no artifacts in that suite and come out `no-culprit`):

```markdown
## Performance attribution

`ab7f898` against baseline `e911fa2` · 6 regression(s) · 3 attributed · 3 no-culprit

| Test / step | Metric | Baseline | Current | Culprit | Confidence | Status |
|---|---|---:|---:|---|---:|---|
| chromium > seeded-regressions.spec.ts > heavy render > Render rows | longTaskCount | 0 | 5 | `example/seeded-regressions/app/server.mjs:59` heavyRender | 0.93 | 🎯 attributed |
| chromium > seeded-regressions.spec.ts > leak > Build reports | heapDiffAddedObjects (+5225 %) | 2393 | 127422 | `example/seeded-regressions/app/server.mjs:39` (anonymous) | 1.00 | 🎯 attributed |
| chromium > seeded-regressions.spec.ts > unindexed query > Look up orders | longTaskCount | 0 | 5 | `example/seeded-regressions/app/server.mjs:72` (anonymous) | 0.83 | 🎯 attributed |

### Evidence

**chromium > seeded-regressions.spec.ts > leak > Build reports**

- `example/seeded-regressions/app/server.mjs:39` (heap, heapDiffAddedObjects, confidence 1.00)
  - 25028 added (array) (6740532 bytes) are retained by closure (anonymous) at example/seeded-regressions/app/server.mjs:39 in 20 of 20 sampled retainer paths
  - retainer path: array:(object elements) <-[elements] object:Array <-[payload] object:LeakedRecord <-[0] object:system / Context <-[context] closure:(anonymous) <-[15315] object:Array <-[recordCache]
```

## Agent

The agent is a tool-calling loop over five [Mastra](https://mastra.ai) tools (`createTool` with zod schemas), driven by hand over one injected `complete(prompt, options)` call; there's no model SDK and no MCP.

| Tool                 | Returns |
|----------------------|---------|
| `read_bundle`        | The regressions with their increased metrics and available artifacts, and the changed lines. |
| `trace_self_time`    | Functions with the most self time in the trace and the lines their samples hit, from the CPU profile parsed by the DevTools trace engine (`@paulirish/trace_engine`). |
| `heap_growth`        | Grown classes, their most common retainer path and the closures on the paths, from the snapshot loaded with memlab. |
| `attribute_to_hunks` | Candidates on changed lines with their evidence; everything outside the changed lines as evidence only. |
| `submit_verdict`     | Records the culprits of a regression. Culprits not backed by a candidate are dropped, any confidence is ignored. |

The tools return a bounded index: metric values, changed lines, function and class names, sizes, edge names and source locations. Never the content of a trace or a heap snapshot: string contents, DOM attributes and url queries are left out. The default `complete` posts to the Anthropic Messages API with `fetch`. Use the library to plug in another model:

```ts
import {attribute} from 'playwright-performance-attribution/cli';

await attribute({
  reportDir: './',
  complete: async (prompt, {model, tools, maxTokens}) => myModel(prompt, tools),
  // Or replace the whole agent: runAttribution: async (bundle, tools) => {...}
});
```

The analysis functions are exported from `playwright-performance-attribution/analysis` (`traceSelfTime`, `heapGrowth`, `attributeToHunks`, `culpritConfidence`, ...).

## Seeded regressions and the eval

[`example/seeded-regressions/`](../../example/seeded-regressions/) holds a dependency-free `node:http` app with three handlers, a suite with identical tests and steps for each, and a Playwright config with `heapDiff({writeSnapshots: true})`, `traceCapture()` and this presenter. The app is a single file the pages load as a module, so trace and heap locations are lines of `app/server.mjs`.

The branch `seeded-regressions` holds two commits and is never merged: its parent has the efficient handlers (the state of `main`), its tip degrades the three handlers and nothing else:

| Seeded regression | Change in `app/server.mjs` | Shows up as |
|-------------------|----------------------------|-------------|
| leak              | `leak()` pushes every record into a new module-level `recordCache` | `heapDiffAddedBytes`, `JSHeapUsedSize` |
| heavy render      | `heavyRender()` reads `offsetHeight` after every appended row | `TaskDuration`, long tasks |
| unindexed query   | `unindexedQuery()` scans the array instead of a `Map` | duration, `ScriptDuration` |

```bash
cd example && npm install && cd ..
npm run build
cd packages/attribution && npm ci
npm run eval                 # needs ANTHROPIC_API_KEY, takes a few minutes
npm run eval -- --scripted   # without a model: an agent that submits the strongest candidate of every regression
```

`npm run eval` creates worktrees of both commits (linking `node_modules` and `lib` of this checkout), runs the base suite `minBaselineRuns + 1` times into one shared history (`PERF_HISTORY_DIR`), runs the head suite once, runs `performance-attribution attribute`, and checks the Done-when: the top-1 culprit is in the degraded handler for at least 2 of 3 regressions, and no culprit is outside the changed lines. It removes the worktrees afterwards (`--keep` keeps them). Ports 4321 and 9222 must be free.

In CI, the jest specs check the same with a scripted agent and a fake `complete()`; the real-agent eval is manual.

Two deviations of the seeded config from the plan, on purpose:

- **Heap snapshots and traces per step, not per test.** Playwright closes the page before the stop of a test, so a test-level `heapDiff` has no page to take its stop snapshot of, and Chrome records one trace per target at a time, so a test-level `traceCapture` would block the step traces. The tests only get `allPerformanceMetrics()`; their regressions are listed with `reason: 'no-artifact'`, the steps carry the attribution.
- **Outputs resolve from the folder of the config** (`example/seeded-regressions/`), not from `example/`: the history (`performance-history/`, or `PERF_HISTORY_DIR`), `heap/`, `traces/` and the reports. A history under `example/` would be shared with the basic suite, whose runs would turn every seeded test and step into `new` or `missing`.

## Decisions beyond the plan

The plan fixed the presenter options at `{outputDir, outputFile, comparison, repoDir?, caps?}`, the CLI flags at `--bundle` to `--no-agent`, and the hunks at `{file, addedRanges}`. These were added, each for a need the plan didn't cover:

| Addition | Why |
|----------|-----|
| `historyDir` option (required) | The comparison report names its baseline runs, but not their `metadata.commit`, which only the history files hold. A dir without any of the baseline runs is warned about and stated in `unresolvedDetail`. |
| `sourceRoots` option, `--source-root` | A served url can't be matched to a repository file by its name without guessing, e.g. a CDN `index.js` against `src/index.js`. A root maps the urls of an origin to a folder exactly. |
| `addedLines` in the hunks (up to 2000 lines per file, 300 characters each) | A heap culprit at a scope variable needs the changed line that fills or declares it, and the CLI needs no repository. It's code of the repository, never page data, and is not sent to the model. |
| `--time-budget` | Bounds the agent, retries included, to keep the attribution step within the 5 minutes of the plan. |
| `attribution.json` | The verdicts machine-readable, which `npm run eval` checks. |
| `unresolvedDetail`, `note: 'comparison-unavailable'` with `noteDetail`, and `unresolved: 'no changes since the baseline commit'` | Every degraded path states its reason instead of a misleading one. |

## Development

```bash
# The package resolves playwright-performance-reporter from the repository root
cd ../.. && npm ci && npm run build
cd packages/attribution && npm ci
npm run typecheck
npm test
# xo with the rules of the repository root, on src, test, eval and bin
npm run lint
```

The package isn't published yet; publishing a second package next to the reporter's semantic-release setup is open.
