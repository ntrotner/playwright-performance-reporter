import path from 'node:path';
import type {
  AttributionBasis,
  BundleRegression,
  ChangedHunk,
  MetricChange,
  SourceRoot,
} from '../types.js';
import {
  culpritConfidence,
} from './confidence.js';
import type {
  HeapGrowth,
} from './heap-growth.js';
import type {
  TraceSelfTime,
} from './trace-self-time.js';
import {
  isTranspiledSource,
  stripUrl,
} from './urls.js';

/**
 * Changed lines of code a regression is attributed to
 */
export type Culprit = {
  /**
   * Changed file, relative to the root of the repository
   */
  file: string;

  /**
   * 1-based lines inside a changed hunk
   */
  startLine: number;
  endLine: number;

  /**
   * Function or class, if known
   */
  symbol?: string;

  /**
   * Increased metric of the same basis the culprit explains, absent if the regression has none,
   * e.g. a CPU culprit of a regression whose increased metrics are all of the heap
   */
  metric?: string;
  basis: AttributionBasis;
  evidence: string[];

  /**
   * Computed from the evidence, between 0 and 1
   */
  confidence: number;
};

/**
 * Candidates of a regression on the changed lines, and the evidence outside of them
 */
export type HunkAttribution = {
  /**
   * Strongest first
   */
  culprits: Culprit[];

  /**
   * What was found outside of the changed lines, never a culprit
   */
  evidence: string[];
};

/**
 * How script urls are matched to changed files
 */
export type MatchOptions = {
  /**
   * Where the app serves files of the repository. Scripts below a root map to exactly one file.
   */
  sourceRoots?: SourceRoot[];

  /**
   * Origins of the pages under test. Scripts of other origins are third party and never match, unless below a root.
   */
  pageOrigins?: string[];
};

/**
 * Trailing path segments a script url and a changed file must share without a source root, e.g. `src/index.js`.
 * The file name alone is too common, e.g. `index.js` of a library.
 */
const minSuffixSegments = 2;

/**
 * Functions outside of the changed lines listed as evidence, the hottest ones
 */
const maxOutsideEvidence = 10;

/**
 * Evidence items kept per culprit when candidates on the same line are merged
 */
const maxCulpritEvidence = 4;

/**
 * Path segments of a path, e.g. `/a/b.js` -> `['a', 'b.js']`
 *
 * @param location path
 */
function segmentsOf(location: string): string[] {
  return location.split(/[\\/]/).filter(segment => segment.length > 0 && segment !== '.');
}

/**
 * Changed file with the longest common path suffix of at least `minSuffixSegments`, none if two fit equally well
 *
 * @param pathname path of the script
 * @param hunks changed files
 */
function matchBySuffix(pathname: string, hunks: ChangedHunk[]): ChangedHunk | undefined {
  const urlSegments = segmentsOf(pathname);
  let best: ChangedHunk | undefined;
  let bestLength = 0;
  let tie = false;
  for (const hunk of hunks) {
    const fileSegments = segmentsOf(hunk.file);
    let length = 0;
    while (length < Math.min(urlSegments.length, fileSegments.length) && urlSegments.at(-1 - length) === fileSegments.at(-1 - length)) {
      length++;
    }

    if (length > bestLength) {
      best = hunk;
      bestLength = length;
      tie = false;
    } else if (length > 0 && length === bestLength) {
      tie = true;
    }
  }

  return tie || bestLength < minSuffixSegments ? undefined : best;
}

/**
 * Changed file a script belongs to, or none rather than a guess:
 * - below a source root, exactly the file the root maps it to;
 * - otherwise only a local file or a script of a page origin, by a common path suffix of at least two segments.
 * Third-party scripts, e.g. of a CDN, never match.
 *
 * @param url url of the script, or a file path
 * @param hunks changed files
 * @param options source roots and page origins
 */
export function matchHunkFile(url: string, hunks: ChangedHunk[], options: MatchOptions = {}): ChangedHunk | undefined {
  const stripped = stripUrl(url);
  for (const root of options.sourceRoots ?? []) {
    if (stripped.startsWith(root.url)) {
      let relative: string;
      try {
        relative = decodeURIComponent(stripped.slice(root.url.length));
      } catch {
        return undefined;
      }

      const file = path.posix.normalize(path.posix.join(root.path, relative));
      return hunks.find(hunk => path.posix.normalize(hunk.file) === file);
    }
  }

  let parsed: URL | undefined;
  try {
    parsed = new URL(stripped);
  } catch {}

  // A plain path, e.g. a script of node
  if (!parsed) {
    return matchBySuffix(stripped, hunks);
  }

  if (parsed.protocol === 'file:') {
    return matchBySuffix(decodeURIComponent(parsed.pathname), hunks);
  }

  if (!(options.pageOrigins ?? []).includes(parsed.origin)) {
    return undefined;
  }

  try {
    return matchBySuffix(decodeURIComponent(parsed.pathname), hunks);
  } catch {
    return undefined;
  }
}

/**
 * Whether a line is one of the added lines of a changed file
 *
 * @param hunk changed file
 * @param line 1-based line
 */
export function isChangedLine(hunk: ChangedHunk, line: number): boolean {
  return hunk.addedRanges.some(range => line >= range.start && line <= range.end);
}

/**
 * Escape a name for a regular expression
 *
 * @param name variable name
 */
function escapeName(name: string): string {
  return name.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * Changed line that fills or declares a scope variable: a call that adds to it (`cache.push(record)`), an assignment,
 * or else its `const`, `let` or `var` declaration. Lines that only read it, or a property of the same name
 * (`other.cache = …`, `{cache: …}`), don't count.
 *
 * @param hunk changed file of the scope
 * @param name variable name
 */
export function findChangedVariable(hunk: ChangedHunk, name: string): number | undefined {
  // Not a property access: no word character, `$` or `.` before the name
  const word = `(?<![\\w$.])${escapeName(name)}(?![\\w$])`;
  const fills = [
    new RegExp(`${word}\\s*\\.\\s*(?:push|unshift|splice|set|add|concat|fill)\\s*\\(`),
    new RegExp(`${word}\\s*\\[[^\\]]*\\]\\s*(?:\\?\\?|\\|\\||&&|\\+)?=(?!=)`),
    new RegExp(`(?<!(?:const|let|var)\\s+)${word}\\s*(?:\\?\\?|\\|\\||&&|\\+)?=(?![=>])`),
  ];
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${word}`);
  const lines = hunk.addedLines ?? [];
  return lines.find(line => fills.some(pattern => pattern.test(line.text)))?.line
    ?? lines.find(line => declaration.test(line.text))?.line;
}

/**
 * Name of a function for the report, `(anonymous)` without one
 *
 * @param functionName name of the function, empty for an anonymous function
 */
function symbolOf(functionName: string): string {
  return functionName.length > 0 ? functionName : '(anonymous)';
}

/**
 * Increased metric of a regression that fits a basis, the most severe first; none if no increased metric fits
 *
 * @param changes increased metrics
 * @param basis cpu or heap
 */
function metricFor(changes: MetricChange[], basis: AttributionBasis): {metric?: string} {
  const isHeap = (metric: string) => /heap|detached/i.test(metric);
  const metric = changes.find(change => isHeap(change.metric) === (basis === 'heap'))?.metric;
  // Never a metric of the other basis, e.g. a heap metric for a CPU culprit
  return metric === undefined ? {} : {metric};
}

/**
 * Milliseconds, rounded for evidence
 *
 * @param value milliseconds
 */
function ms(value: number): string {
  return `${Math.round(value * 10) / 10} ms`;
}

/**
 * CPU: a function is a culprit only if its own self time, i.e. the lines its samples hit, is on changed lines.
 * It's reported at its hottest changed line. Source-mapped scripts are skipped, their lines are not the repository's.
 *
 * @param regression regressed test or step
 * @param trace self time of its trace
 * @param hunks changed files
 * @param options source roots
 */
function attributeCpu(regression: BundleRegression, trace: TraceSelfTime, hunks: ChangedHunk[], options: MatchOptions): HunkAttribution {
  const culprits: Culprit[] = [];
  const evidence: string[] = [];
  for (const fn of trace.functions) {
    const symbol = symbolOf(fn.functionName);
    if (fn.sourceMapped) {
      if (evidence.length < maxOutsideEvidence) {
        evidence.push(`${symbol} (${fn.url}:${fn.line}) has ${ms(fn.selfTime)} self time in a source-mapped or transpiled script, whose lines are not matched`);
      }

      continue;
    }

    const hunk = matchHunkFile(fn.url, hunks, {...options, pageOrigins: trace.pageOrigins});
    const changedLines = hunk ? fn.lines.filter(line => isChangedLine(hunk, line.line)) : [];
    if (!hunk || changedLines.length === 0) {
      if (evidence.length < maxOutsideEvidence) {
        evidence.push(`${symbol} (${fn.url}:${fn.line}) has ${ms(fn.selfTime)} self time outside of the changed lines`);
      }

      continue;
    }

    const changedTime = changedLines.reduce((sum, line) => sum + line.selfTime, 0);
    const share = trace.totalSelfTime > 0 ? changedTime / trace.totalSelfTime : 0;
    const [hottest] = changedLines;
    culprits.push({
      file: hunk.file,
      startLine: hottest.line,
      endLine: hottest.line,
      symbol,
      ...metricFor(regression.changes, 'cpu'),
      basis: 'cpu',
      evidence: [
        `${symbol} spends ${ms(changedTime)} of its ${ms(fn.selfTime)} self time on changed lines ${changedLines.slice(0, 5).map(line => `${line.line} (${ms(line.selfTime)})`).join(', ')}${changedLines.length > 5 ? ', …' : ''}, ${Math.round(share * 100)} % of the sampled ${ms(trace.totalSelfTime)}`,
      ],
      confidence: culpritConfidence(share, regression.changes),
    });
  }

  return {culprits, evidence};
}

/**
 * Step of a retainer path that lies on a changed line
 */
type HeapSite = {
  file: string;
  line: number;
  distance: number;
  hits: number;
  via: string;

  /**
   * The line is found by the name of a variable in the changed text, not located in the snapshot like a closure
   */
  byName: boolean;
};

/**
 * Frames of the retainer paths of a class inside a changed hunk: closures defined on a changed line, and scope
 * variables whose changed line in the script of the scope fills or declares them
 *
 * @param growth growth of the class
 * @param hunks changed files
 * @param options source roots and page origins
 */
function heapSites(growth: HeapGrowth['classes'][number], hunks: ChangedHunk[], options: MatchOptions): HeapSite[] {
  const fileOf = (url: string, sourceMapped?: boolean) => sourceMapped === true || isTranspiledSource(url) ? undefined : matchHunkFile(url, hunks, options);
  const sites: HeapSite[] = [];
  for (const frame of growth.frames) {
    const hunk = fileOf(frame.url, frame.sourceMapped);
    if (hunk && isChangedLine(hunk, frame.line)) {
      sites.push({
        file: hunk.file, line: frame.line, distance: frame.distance, hits: frame.hits, via: `closure ${symbolOf(frame.functionName)}`, byName: false,
      });
    }
  }

  for (const variable of growth.variables) {
    // Only in the script of the scope the variable belongs to
    const hunk = fileOf(variable.url, variable.sourceMapped);
    const line = hunk ? findChangedVariable(hunk, variable.name) : undefined;
    if (hunk && line !== undefined) {
      sites.push({
        file: hunk.file, line, distance: variable.distance, hits: variable.hits, via: `variable ${variable.name}`, byName: true,
      });
    }
  }

  // Lines located in the snapshot come first, then the deepest frame
  return sites.sort((a, b) => Number(a.byName) - Number(b.byName) || a.distance - b.distance || b.hits - a.hits);
}

/**
 * Heap: a class is attributed only if a frame of its retainer paths lies inside a changed hunk: a closure defined on
 * a changed line, located in the snapshot, or a scope variable that a changed line of its script fills or declares,
 * found by its name in the changed text. Located frames rank first, then the deepest, closest to the objects.
 *
 * @param regression regressed test or step
 * @param heap class growth of its heap snapshot
 * @param hunks changed files
 * @param options source roots and page origins
 */
function attributeHeap(regression: BundleRegression, heap: HeapGrowth, hunks: ChangedHunk[], options: MatchOptions): HunkAttribution {
  const culprits: Culprit[] = [];
  const evidence: string[] = [];
  for (const growth of heap.classes) {
    const [site] = heapSites(growth, hunks, options);
    if (!site) {
      evidence.push(`${growth.count} added ${growth.name} (${growth.selfSize} bytes) are retained by ${growth.retainerPath.slice(0, 4).join(' ') || 'unknown retainers'}, outside of the changed lines`);
      continue;
    }

    const share = growth.sampled > 0 ? Math.min(1, site.hits / growth.sampled) : 0;
    culprits.push({
      file: site.file,
      startLine: site.line,
      endLine: site.line,
      symbol: site.via.replace(/^\w+ /, ''),
      ...metricFor(regression.changes, 'heap'),
      basis: 'heap',
      evidence: [
        `${growth.count} added ${growth.name} (${growth.selfSize} bytes) are retained through ${site.via}, changed at ${site.file}:${site.line}, in ${site.hits} of ${growth.sampled} sampled retainer paths${site.byName ? '; the line is found by its name in the changed lines, not located in the snapshot' : ''}`,
        `retainer path: ${growth.retainerPath.slice(0, 6).join(' ')}`,
      ],
      confidence: culpritConfidence(share, regression.changes),
    });
  }

  return {culprits, evidence};
}

/**
 * Attribute a regression to the changed lines, from the self time of its trace and the class growth of its heap
 * snapshot. Every culprit lies inside a changed hunk; everything else becomes evidence. Candidates of the same basis
 * on the same line are merged, keeping the strongest.
 *
 * @param regression regressed test or step
 * @param analyses self time and class growth, if available
 * @param analyses.trace self time of the trace
 * @param analyses.heap class growth of the heap snapshot
 * @param hunks changed files
 * @param options source roots; the page origins come from the trace
 */
export function attributeToHunks(regression: BundleRegression, analyses: {trace?: TraceSelfTime; heap?: HeapGrowth}, hunks: ChangedHunk[], options: MatchOptions = {}): HunkAttribution {
  // A heap snapshot doesn't name the page, so its scripts are first party on the origins of the trace of the same step
  const heapOptions = {...options, pageOrigins: [...(options.pageOrigins ?? []), ...(analyses.trace?.pageOrigins ?? [])]};
  const parts = [
    ...(analyses.trace ? [attributeCpu(regression, analyses.trace, hunks, options)] : []),
    ...(analyses.heap ? [attributeHeap(regression, analyses.heap, hunks, heapOptions)] : []),
  ];
  const byLine = new Map<string, Culprit>();
  for (const culprit of parts.flatMap(part => part.culprits)) {
    // Per basis, so a CPU and a heap culprit on the same line are both kept
    const key = `${culprit.basis}|${culprit.file}:${culprit.startLine}`;
    const existing = byLine.get(key);
    if (existing && existing.confidence >= culprit.confidence) {
      existing.evidence.push(...culprit.evidence);
    } else {
      byLine.set(key, existing ? {...culprit, evidence: [...culprit.evidence, ...existing.evidence]} : culprit);
    }
  }

  return {
    culprits: [...byLine.values()]
      .map(culprit => ({...culprit, evidence: culprit.evidence.slice(0, maxCulpritEvidence)}))
      .sort((a, b) => b.confidence - a.confidence),
    evidence: parts.flatMap(part => part.evidence),
  };
}
