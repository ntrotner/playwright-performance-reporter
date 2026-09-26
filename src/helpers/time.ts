/**
 * Round to microsecond precision and convert to milliseconds
 *
 * @param microseconds value to convert
 */
export function microsecondsToMilliseconds(microseconds: number): number {
  return Math.round(microseconds) / 1000;
}
