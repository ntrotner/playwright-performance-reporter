/**
 * Options for garbage collector observer
 */
export type GarbageCollectorObserverOptions = {
  triggerGarbageCollectionOnObserve: boolean;
};

/**
 * Aggregated options for all observers
 */
export type ObserverOptions = GarbageCollectorObserverOptions;
