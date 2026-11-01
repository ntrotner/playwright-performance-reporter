import path from 'node:path';
import type {
  ChangedFile,
  LineRange,
} from '../types.js';

/**
 * Extensions of sources a dev server transpiles before it serves them, so their served lines aren't the lines of the
 * repository. Without a source map their frames are never matched.
 */
const transpiledExtensions = /\.(?:ts|tsx|mts|cts|jsx|vue|svelte|coffee)$/i;

/**
 * Trailing path segments a script and a changed file must share, unless the script is the exact repository path
 */
const minimumSharedSegments = 2;

/**
 * Url or path without query and fragment, which can carry tokens
 *
 * @param url url of a script
 */
export function stripUrl(url: string): string {
  return url.replace(/[?#].*$/, '');
}

/**
 * Path of a script url, e.g. `/app/server.mjs` of `http://localhost:4321/app/server.mjs?v=1`, normalized to forward
 * slashes without dot segments and without a leading slash
 *
 * @param url http(s) or file url, or a path
 */
export function normalizeScriptPath(url: string): string | undefined {
  let pathname = stripUrl(url.trim());
  if (/^[a-z][\w+.-]*:/i.test(pathname)) {
    try {
      const parsed = new URL(pathname);
      if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
        return undefined;
      }

      pathname = parsed.pathname;
    } catch {
      return undefined;
    }
  }

  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const normalized = path.posix.normalize(pathname.replaceAll('\\', '/')).replace(/^(?:\.\/|\/)+/, '');
  return normalized && normalized !== '.' && !normalized.startsWith('../') && !/\s/.test(normalized) ? normalized : undefined;
}

/**
 * Changed file a script url refers to. Matches the exact repository path, or at least two trailing path segments,
 * and only if exactly one changed file matches; transpiled sources never match. Never a guess.
 *
 * @param changedFiles changed files of the bundle
 * @param url url or path of a script, e.g. of a trace frame or a heap snapshot closure
 */
export function findChangedFile(changedFiles: ChangedFile[], url: string): ChangedFile | undefined {
  const scriptPath = normalizeScriptPath(url);
  if (!scriptPath || transpiledExtensions.test(scriptPath)) {
    return undefined;
  }

  const exact = changedFiles.find(file => file.file === scriptPath);
  if (exact) {
    return exact;
  }

  const scriptSegments = scriptPath.split('/');
  const matches = changedFiles.filter(file => {
    const fileSegments = file.file.split('/');
    const shared = Math.min(scriptSegments.length, fileSegments.length);
    return shared >= minimumSharedSegments && scriptSegments.slice(-shared).join('/') === fileSegments.slice(-shared).join('/');
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Added range of a changed file that contains a line
 *
 * @param file changed file
 * @param line 1-based line
 */
export function findHunk(file: ChangedFile, line: number): LineRange | undefined {
  return file.addedRanges.find(range => range.start <= line && line <= range.end);
}
