import {createHash} from 'node:crypto';

/**
 * Transforms string into md5 hash
 *
 * @param input string to transform
 */
export function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}
