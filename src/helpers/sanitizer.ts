/**
 * Fixes `js/prototype-polluting-assignment`
 */
export function sanitizeStringInput(input: string): string {
  if (input === '__proto__' || input === 'constructor' || input === 'prototype') {
    return '';
  }

  return input;
}
