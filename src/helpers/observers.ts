import {
  type GarbageCollectorObserverOptions,
  type MeasurePlugin,
  type MetricObserver,
} from '../types/index.js';

/**
 * Generic function to enhance plugins
 *
 * @param condition
 * @param plugin
 * @param observer
 */
function enhancePlugin(
  condition: boolean,
  plugin: MeasurePlugin<unknown>,
  observer: MetricObserver<unknown>,
): void {
  if (condition) {
    observer.plugins.push(plugin);
  }
}

/**
 * Enhances garbage collection plugin
 *
 * @param options
 * @param garbageCollectorPlugin
 * @param observer
 */
export function enhanceGarbageCollectionPlugin(
  garbageCollectorPlugin: MeasurePlugin<any>,
  observer: MetricObserver<any>,
  options?: GarbageCollectorObserverOptions,
): void {
  enhancePlugin(Boolean(options?.triggerGarbageCollectionOnObserve), garbageCollectorPlugin, observer);
}
