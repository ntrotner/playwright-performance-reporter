export function assignConfig<T extends Record<string, unknown>>(target: T, source?: Partial<T>) {
  return Object.assign(target, source);
}
