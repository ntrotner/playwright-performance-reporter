/**
 * Extensions of sources a dev server transpiles before it serves them, so their served lines differ
 */
const transpiledExtensions = /\.(?:ts|tsx|mts|cts|jsx|vue|svelte|coffee)$/i;

/**
 * Url without query and fragment, which can carry tokens
 *
 * @param url url of a script
 */
export function stripUrl(url: string): string {
  return url.replace(/[?#].*$/, '');
}

/**
 * Whether a script url is a source that is transpiled before it runs
 *
 * @param url url of the script
 */
export function isTranspiledSource(url: string): boolean {
  return transpiledExtensions.test(stripUrl(url));
}
