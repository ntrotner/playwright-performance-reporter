import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type {
  PresenterWriter,
  ResultAccumulator,
  TargetMetric,
  testCaseParent,
} from 'playwright-performance-reporter';
import {
  type AttributionBundle,
  type ArtifactRef,
  type BundleRegression,
  bundleFileName,
  type ComparisonPresenter,
  type ComparisonReport,
  type RevisionReason,
  type StepComparison,
} from '../types.js';
import {
  resolveChangedFiles,
} from './changed-files.js';

/**
 * Step id of the test itself in the json chunks, typed against the constant of the reporter without importing it
 */
const testCaseParentId: typeof testCaseParent = 'TEST_CASE_PARENT';

/**
 * Options for the attribution presenter
 */
export type AttributionPresenterOptions = {
  outputDir: string;

  /**
   * Defaults to `attribution-bundle.json`
   */
  outputFile?: string;

  /**
   * Comparison presenter of the same run, whose report holds the regressions
   */
  comparison: Pick<ComparisonPresenter, 'getReport'>;

  /**
   * `historyDir` of the comparison presenter. The report only names the baseline runs, their commit is in these files.
   * Without it the changed hunks can't be resolved (`no-revision-metadata`).
   */
  historyDir?: string;

  /**
   * Directory inside the git repository of the code under test. Defaults to the working directory.
   */
  repoDir?: string;
};

/**
 * Artifacts and position of a test or step, merged across its chunks
 */
type EntityRecord = {
  caseId: string;
  name: string;
  isTest: boolean;

  /**
   * Start of the measurement, ordered like the comparison presenter orders tests and steps
   */
  start: number | undefined;
  firstSeen: number;
  metadata?: Record<string, string>;
  traceFile?: string;
  heapDiffFile?: string;
  heapDiffTopClasses?: string;
};

/**
 * Metrics an entity records its artifacts in
 */
const artifactMetrics = ['traceFile', 'heapDiffFile', 'heapDiffTopClasses'] as const;

/**
 * Hands off the regressions of a run to the attribution step of `performance-attribution`. Writes one bundle when it
 * is closed: the regressions of the comparison presenter, the paths of their traces and heap snapshots, and the lines
 * that changed since the baseline commit. It never opens an artifact, never calls a model and never throws.
 */
export class AttributionPresenter implements PresenterWriter {
  private readonly entities = new Map<string, EntityRecord>();

  private readonly filePath: string;

  /**
   * Result of closing, to write the bundle only once
   */
  private closing: Promise<boolean> | undefined;

  private written = false;

  constructor(private readonly options: AttributionPresenterOptions) {
    this.filePath = path.join(options.outputDir, options.outputFile ?? bundleFileName);
  }

  /**
   * Collect the metadata and the artifact paths of every test and step
   *
   * @param content json chunk
   */
  async write(content: ResultAccumulator): Promise<boolean> {
    try {
      for (const [caseId, steps] of Object.entries(content ?? {})) {
        for (const [stepId, performance] of Object.entries(steps ?? {})) {
          this.collect(caseId, stepId, performance);
        }
      }
    } catch (error) {
      console.warn(`[PerformanceAttribution] Ignored a chunk: ${String(error)}`);
    }

    return true;
  }

  /**
   * Write the bundle, once
   */
  async close(): Promise<boolean> {
    this.closing ??= this.finish();
    return this.closing;
  }

  /**
   * Remove the bundle, and never write it afterwards
   */
  async delete(): Promise<boolean> {
    this.closing ??= Promise.resolve(false);
    await this.closing;
    if (this.written) {
      fs.rmSync(this.filePath, {force: true, maxRetries: 5, retryDelay: 500});
    }

    return true;
  }

  private collect(caseId: string, stepId: string, performance: ResultAccumulator[string][string]): void {
    const key = `${caseId}|${stepId}`;
    const entity = this.entities.get(key) ?? {
      caseId, name: performance.name, isTest: stepId === testCaseParentId, start: undefined, firstSeen: performance.startMeasurement,
    };
    entity.firstSeen = Math.min(entity.firstSeen, performance.startMeasurement);
    if (performance.startMetrics?.length > 0 || performance.startMeasurementOffset !== undefined) {
      entity.start = performance.startMeasurement;
    }

    entity.metadata ??= performance.metadata;
    const targetMetrics: TargetMetric[] = [...(performance.startMetrics ?? []), ...(performance.samplingMetrics ?? []), ...(performance.stopMetrics ?? [])];
    for (const targetMetric of targetMetrics) {
      for (const metric of artifactMetrics) {
        const value = targetMetric?.metric?.[metric];
        if (typeof value === 'string' && value.length > 0) {
          entity[metric] = value;
        }
      }
    }

    this.entities.set(key, entity);
  }

  /**
   * Build and write the bundle. Every failure ends up in the status of the bundle, or in the log if it can't be written.
   */
  private async finish(): Promise<boolean> {
    let bundle: AttributionBundle;
    try {
      bundle = await this.buildBundle();
    } catch (error) {
      bundle = {
        schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'error', message: `Building the attribution bundle failed: ${String(error)}`, run: {}, regressions: [], changedFiles: [],
      };
    }

    try {
      await fs.promises.mkdir(this.options.outputDir, {recursive: true});
      const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
      await fs.promises.writeFile(temporaryPath, JSON.stringify(bundle, null, 2));
      await fs.promises.rename(temporaryPath, this.filePath);
      this.written = true;
      return true;
    } catch (error) {
      console.warn(`[PerformanceAttribution] Failed to write the attribution bundle ${this.filePath}: ${String(error)}`);
      return false;
    }
  }

  private async buildBundle(): Promise<AttributionBundle> {
    const metadata = [...this.entities.values()].find(entity => entity.isTest && entity.metadata)?.metadata;
    let report: ComparisonReport | undefined;
    let reportError: string | undefined;
    try {
      report = await this.options.comparison?.getReport();
    } catch (error) {
      reportError = String(error);
    }

    const firstStart = Math.min(...[...this.entities.values()].map(entity => entity.firstSeen));
    const bundle: AttributionBundle = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'ok',
      message: '',
      run: {
        commit: metadata?.commit,
        branch: metadata?.branch,
        startedAt: report?.currentRun?.startedAt ?? (Number.isFinite(firstStart) ? new Date(firstStart).toISOString() : undefined),
      },
      regressions: [],
      changedFiles: [],
    };

    if (!report) {
      bundle.status = 'no-comparison';
      bundle.message = reportError
        ? `The comparison report is unavailable: ${reportError}`
        : 'The comparison presenter has no report: nothing was measured, or its comparison failed.';
      return bundle;
    }

    bundle.comparison = {status: report.status, message: report.message};
    bundle.settings = report.settings;
    const entities = this.keyEntities();
    bundle.regressions = report.steps
      .filter(step => step.status === 'regressed' || step.status === 'mixed')
      .map(step => this.toRegression(step, entities.get(step.key)));
    if (bundle.regressions.length === 0) {
      bundle.status = 'no-regressions';
      bundle.message = `Nothing to attribute: ${report.message}`;
      return bundle;
    }

    const unresolved = (reason: RevisionReason, message: string): AttributionBundle => ({...bundle, status: reason, message});
    if (!bundle.run.commit) {
      return unresolved('no-revision-metadata', 'The run recorded no commit (metadata.commit), so its changes are unknown.');
    }

    const baseline = await this.readBaselineCommit(report, bundle.run.commit);
    if ('reason' in baseline) {
      return unresolved('no-revision-metadata', baseline.reason);
    }

    bundle.run.baselineCommit = baseline.commit;
    const resolved = await resolveChangedFiles(this.options.repoDir ?? process.cwd(), baseline.commit, bundle.run.commit);
    if ('reason' in resolved) {
      return unresolved(resolved.reason, resolved.message);
    }

    bundle.changedFiles = resolved.changedFiles;
    bundle.message = `${bundle.regressions.length} regression(s) and ${bundle.changedFiles.length} changed file(s) between ${baseline.commit.slice(0, 7)} and ${bundle.run.commit.slice(0, 7)}.`;
    return bundle;
  }

  /**
   * Regression of a compared test or step, with its increased metrics and the artifacts it wrote
   *
   * @param step comparison of the test or step
   * @param entity artifacts of the test or step in the current run
   */
  private toRegression(step: StepComparison, entity: EntityRecord | undefined): BundleRegression {
    const regression: BundleRegression = {
      entityKey: step.key,
      kind: step.kind,
      name: step.name,
      testName: step.testName,
      ...(step.stepName === undefined ? {} : {stepName: step.stepName}),
      status: step.status as BundleRegression['status'],
      duration: step.duration,
      changes: step.changes.filter(change => change.status === 'increased'),
    };
    if (entity?.traceFile) {
      regression.traceFile = this.toArtifactRef(entity.traceFile);
    }

    if (entity?.heapDiffFile) {
      regression.heapDiffFile = this.toArtifactRef(entity.heapDiffFile);
    }

    if (entity?.heapDiffTopClasses) {
      regression.heapDiffTopClasses = entity.heapDiffTopClasses;
    }

    if (!regression.traceFile && !regression.heapDiffFile) {
      regression.artifactReason = 'no-artifact';
    }

    return regression;
  }

  private toArtifactRef(file: string): ArtifactRef {
    return {file, absoluteFile: path.resolve(process.cwd(), file)};
  }

  /**
   * Key every test and step like the comparison presenter: the test id for tests,
   * and the test id, step name and occurrence in order of the start for steps
   */
  private keyEntities(): Map<string, EntityRecord> {
    const occurrences = new Map<string, number>();
    const keyed = new Map<string, EntityRecord>();
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
   * Commit of the newest baseline run that recorded one other than the commit of the run, as re-runs of the same
   * commit can be part of the baseline. If every baseline run is of the run commit, that commit, so nothing changed.
   *
   * @param report comparison of the run
   * @param commit commit of the run
   */
  private async readBaselineCommit(report: ComparisonReport, commit: string): Promise<{commit: string} | {reason: string}> {
    const {historyDir} = this.options;
    if (!historyDir) {
      return {reason: 'The baseline commit is unknown: pass the historyDir of the comparison presenter to the attribution presenter.'};
    }

    if (report.baselineRuns.length === 0) {
      return {reason: 'The comparison has no baseline runs, so there is no baseline commit.'};
    }

    let sameCommit = false;
    // Newest first
    for (const run of [...report.baselineRuns].reverse()) {
      // eslint-disable-next-line no-await-in-loop
      const baselineCommit = await this.readRunCommit(path.join(historyDir, run.file));
      if (baselineCommit && baselineCommit !== commit) {
        return {commit: baselineCommit};
      }

      sameCommit ||= baselineCommit === commit;
    }

    return sameCommit
      ? {commit}
      : {reason: `None of the ${report.baselineRuns.length} baseline run(s) in ${historyDir} recorded a commit (metadata.commit).`};
  }

  /**
   * Commit of a run in the history, from the metadata of its first test
   *
   * @param file json chunks of the run
   */
  private async readRunCommit(file: string): Promise<string | undefined> {
    try {
      const chunks = JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown;
      if (!Array.isArray(chunks)) {
        return undefined;
      }

      return (chunks as ResultAccumulator[])
        .flatMap(chunk => Object.values(chunk ?? {}))
        .map(steps => steps?.[testCaseParentId]?.metadata?.commit)
        .find(value => typeof value === 'string' && value.length > 0);
    } catch {
      return undefined;
    }
  }
}
