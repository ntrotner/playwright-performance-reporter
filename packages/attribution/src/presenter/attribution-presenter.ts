import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  type PresenterWriter,
  type ResultAccumulator,
  testCaseParent,
} from 'playwright-performance-reporter';
import {
  type ArtifactPath,
  type AttributionBasis,
  type AttributionBundle,
  type AttributionCaps,
  type BundleRegression,
  type ComparisonReport,
  type SourceRoot,
  type StepComparison,
  bundleFileName,
  defaultCaps,
} from '../types.js';
import {
  resolveChangedLines,
} from './changed-lines.js';

/**
 * Metrics of the heap, attributed by class growth instead of function self time
 */
const heapMetricPattern = /heap|detached/i;

/**
 * Options for the attribution presenter
 */
export type AttributionPresenterOptions = {
  outputDir: string;

  /**
   * Defaults to `performance-attribution.json`
   */
  outputFile?: string;

  /**
   * Comparison presenter of the same run, registered before this presenter
   */
  comparison: {getReport(): Promise<ComparisonReport | undefined>};

  /**
   * History directory of the comparison presenter, to read the commit of the baseline runs
   */
  historyDir: string;

  /**
   * Directory inside the git repository of the code under test. Defaults to the working directory.
   */
  repoDir?: string;

  /**
   * Limits of the attribution step, written into the bundle as defaults of the CLI
   */
  caps?: Partial<AttributionCaps>;

  /**
   * Where the app under test serves files of the repository, e.g.
   * `[{url: 'http://localhost:4321/', path: path.join(__dirname, 'app')}]`. `path` is absolute or relative to the
   * repository root. Scripts of other origins are matched to changed files only by two or more trailing path segments
   * and only on the origin of the page.
   */
  sourceRoots?: SourceRoot[];
};

/**
 * Artifacts and position of a test or step, merged across its chunks
 */
type EntityArtifacts = {
  caseId: string;
  name: string;
  isTest: boolean;

  /**
   * Start of the measurement, like the comparison presenter orders tests and steps
   */
  start: number | undefined;
  firstSeen: number;
  artifacts: Record<string, string>;
  heapDiffTopClasses?: string;
  metadata?: Record<string, string>;
};

/**
 * Hands off the regressions of a run to the attribution step of `performance-attribution`: writes a bundle with
 * the regressions of the comparison presenter, the paths of their traces and heap snapshots, and the lines that
 * changed since the baseline commit. It never opens an artifact and never calls a model.
 */
export class AttributionPresenter implements PresenterWriter {
  private readonly entities = new Map<string, EntityArtifacts>();

  private readonly filePath: string;

  /**
   * Result of closing, to write the bundle only once
   */
  private closing: Promise<boolean> | undefined;

  constructor(private readonly options: AttributionPresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile ?? bundleFileName);
  }

  /**
   * @inheritdoc
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    for (const [caseId, steps] of Object.entries(content)) {
      for (const [stepId, performance] of Object.entries(steps ?? {})) {
        const key = `${caseId}|${stepId}`;
        const entity = this.entities.get(key) ?? {
          caseId, name: performance.name, isTest: stepId === testCaseParent, start: undefined, firstSeen: performance.startMeasurement, artifacts: {},
        };
        entity.firstSeen = Math.min(entity.firstSeen, performance.startMeasurement);
        if (performance.startMetrics?.length > 0 || performance.startMeasurementOffset !== undefined) {
          entity.start = performance.startMeasurement;
        }

        entity.metadata ??= performance.metadata;
        // Pages describe the test better than workers or frames, so they win over other targets
        const targetMetrics = [...(performance.stopMetrics ?? [])].sort((a, b) => Number(a?.type === 'page') - Number(b?.type === 'page'));
        for (const targetMetric of targetMetrics) {
          for (const [metric, value] of Object.entries(targetMetric?.metric ?? {})) {
            if (typeof value === 'string' && metric.endsWith('File')) {
              entity.artifacts[metric] = value;
            } else if (metric === 'heapDiffTopClasses' && typeof value === 'string') {
              entity.heapDiffTopClasses = value;
            }
          }
        }

        this.entities.set(key, entity);
      }
    }

    return true;
  }

  /**
   * @inheritdoc
   */
  async close(): Promise<boolean> {
    this.closing ??= this.finish();
    return this.closing;
  }

  /**
   * @inheritdoc
   */
  async delete(): Promise<boolean> {
    await this.close();
    fs.rmSync(this.filePath, {force: true, maxRetries: 5, retryDelay: 500});
    return true;
  }

  /**
   * Build the bundle and write it. Never throws, as it runs at the end of the test run.
   */
  private async finish(): Promise<boolean> {
    try {
      const bundle = await this.buildBundle();
      await fs.promises.mkdir(this.options.outputDir, {recursive: true});
      await fs.promises.writeFile(this.filePath, JSON.stringify(bundle, null, 2));
      return true;
    } catch (error) {
      console.log(`[PerformanceAttribution] Failed to write the attribution bundle: ${String(error)}`);
      return false;
    }
  }

  private async buildBundle(): Promise<AttributionBundle> {
    let report: ComparisonReport | undefined;
    let unavailable: string | undefined;
    try {
      report = await this.options.comparison.getReport();
      if (!report) {
        unavailable = 'the comparison presenter has no report: nothing was measured, or its comparison failed';
      } else if (report.status === 'no-baseline' || report.status === 'invalid-current-run') {
        unavailable = `comparison status ${report.status}: ${report.message}`;
      }
    } catch (error: unknown) {
      unavailable = `comparison report unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }

    const entitiesByKey = this.keyEntities();
    const metadata = [...this.entities.values()].find(entity => entity.isTest && entity.metadata)?.metadata;
    const headCommit = metadata?.commit;
    const baseline = await this.readBaselineCommit(report, headCommit);
    const baselineCommit = baseline.commit;
    const regressions = (report?.steps ?? [])
      .filter(step => step.status === 'regressed' || step.status === 'mixed')
      .map(step => this.toRegression(step, entitiesByKey.get(step.key)));
    const repoDir = this.options.repoDir ?? process.cwd();
    const changed = await resolveChangedLines(repoDir, baselineCommit, headCommit ?? 'HEAD');
    const {hunks, unresolved} = changed;
    const unresolvedDetail = unresolved === 'no revision metadata' || baseline.sameAsHead ? baseline.detail : changed.unresolvedDetail;
    const sourceRoots = (this.options.sourceRoots ?? []).map(root => ({
      url: root.url,
      // Relative to the repository root, like the changed files
      path: path.relative(changed.root ?? repoDir, path.resolve(changed.root ?? repoDir, root.path)).split(path.sep).join('/'),
    }));
    const {steps, ...comparison} = report ?? {steps: undefined};

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      // A run without a comparison didn't regress or improve, it wasn't compared
      ...(unavailable ? {note: 'comparison-unavailable' as const, noteDetail: unavailable.slice(0, 400)} : {}),
      ...(!unavailable && regressions.length === 0 ? {note: 'no-regressions' as const} : {}),
      run: {
        commit: headCommit, branch: metadata?.branch, baselineCommit, metadata,
      },
      ...(unresolved ? {unresolved} : {}),
      ...(unresolved && unresolvedDetail ? {unresolvedDetail} : {}),
      hunks,
      ...(sourceRoots.length > 0 ? {sourceRoots} : {}),
      regressions,
      caps: {...defaultCaps, ...this.options.caps},
      ...(report ? {comparison: comparison as Omit<ComparisonReport, 'steps'>} : {}),
    };
  }

  /**
   * Regression of a compared test or step, with its increased metrics and the artifacts it wrote
   *
   * @param step comparison of the test or step
   * @param entity artifacts of the test or step in the current run
   */
  private toRegression(step: StepComparison, entity: EntityArtifacts | undefined): BundleRegression {
    const changes = step.changes.filter(change => change.status === 'increased');
    const basis = new Set<AttributionBasis>(changes.map(change => heapMetricPattern.test(change.metric) ? 'heap' : 'cpu'));
    const artifacts: BundleRegression['artifacts'] = {};
    if (entity?.artifacts.traceFile) {
      artifacts.traceFile = this.toArtifactPath(entity.artifacts.traceFile);
    }

    if (entity?.artifacts.heapDiffFile) {
      artifacts.heapDiffFile = this.toArtifactPath(entity.artifacts.heapDiffFile);
    }

    return {
      entityKey: step.key,
      name: step.name,
      kind: step.kind,
      testId: step.testId,
      testName: step.testName,
      ...(step.stepName === undefined ? {} : {stepName: step.stepName}),
      ...(step.occurrence === undefined ? {} : {occurrence: step.occurrence}),
      status: step.status as BundleRegression['status'],
      duration: step.duration,
      changes,
      basis: (['cpu', 'heap'] as const).filter(item => basis.has(item)),
      artifacts,
      ...(entity?.heapDiffTopClasses ? {heapDiffTopClasses: entity.heapDiffTopClasses} : {}),
      ...(Object.keys(artifacts).length === 0 ? {reason: 'no-artifact' as const} : {}),
    };
  }

  /**
   * Path of an artifact as recorded, and resolved against the working directory of the run
   *
   * @param file path recorded by the observer
   */
  private toArtifactPath(file: string): ArtifactPath {
    return {file, absoluteFile: path.resolve(process.cwd(), file)};
  }

  /**
   * Key every test and step like the comparison presenter does: the test id for tests,
   * and test id, step name and occurrence in order of the start for steps
   */
  private keyEntities(): Map<string, EntityArtifacts> {
    const occurrences = new Map<string, number>();
    const keyed = new Map<string, EntityArtifacts>();
    const ordered = [...this.entities.values()].sort((a, b) => (a.start ?? a.firstSeen) - (b.start ?? b.firstSeen));
    for (const entity of ordered) {
      const occurrenceKey = `${entity.caseId}|${entity.name}`;
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      keyed.set(entity.isTest ? entity.caseId : `${entity.caseId}|${entity.name}|${occurrence}`, entity);
    }

    return keyed;
  }

  /**
   * Commit of the newest baseline run that recorded one other than the current commit, as a re-run of the current
   * commit can be part of the baseline. If every baseline run is of the current commit, that commit, marked as such.
   *
   * @param report comparison of the run
   * @param headCommit current commit
   */
  private async readBaselineCommit(report: ComparisonReport | undefined, headCommit: string | undefined): Promise<{commit?: string; detail?: string; sameAsHead?: boolean}> {
    const baselineRuns = report?.baselineRuns ?? [];
    if (baselineRuns.length === 0) {
      return {detail: 'the comparison has no baseline runs'};
    }

    const missing = baselineRuns.filter(run => !fs.existsSync(path.join(this.options.historyDir, run.file)));
    if (missing.length === baselineRuns.length) {
      const detail = `the history dir ${this.options.historyDir} contains none of the ${baselineRuns.length} baseline run(s) of the comparison, pass the historyDir of the comparison presenter`;
      console.warn(`[PerformanceAttribution] ${detail}`);
      return {detail};
    }

    const failures: string[] = [];
    let headRuns = 0;
    // Newest first; runs of the current commit, e.g. a re-run, have no changes to diff
    for (const run of [...baselineRuns].reverse()) {
      const file = path.join(this.options.historyDir, run.file);
      try {
        // eslint-disable-next-line no-await-in-loop
        const chunks = JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown;
        if (!Array.isArray(chunks)) {
          throw new TypeError('not a list of json chunks');
        }

        const commit = (chunks as ResultAccumulator[])
          .flatMap(chunk => Object.values(chunk ?? {}))
          .map(steps => steps?.[testCaseParent]?.metadata?.commit)
          .find(value => typeof value === 'string' && value.length > 0);
        if (commit && commit !== headCommit) {
          return {commit};
        }

        if (commit) {
          headRuns++;
        }
      } catch (error: unknown) {
        const message = `baseline history ${file} is unreadable: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[PerformanceAttribution] ${message}`);
        failures.push(message);
      }
    }

    if (headRuns > 0 && failures.length === 0) {
      return {commit: headCommit, sameAsHead: true, detail: `every baseline run is of the current commit ${headCommit!.slice(0, 7)}`};
    }

    return {
      detail: failures.length > 0
        ? `${failures.length} of ${baselineRuns.length} baseline run(s) could not be read, e.g. ${failures[0]}`.slice(0, 400)
        : `none of the ${baselineRuns.length} baseline run(s) recorded a commit (metadata.commit)`,
    };
  }
}
