export class ChromiumCDPFixture {
  public send = jest.fn();
  public on = jest.fn();
  public Debugger = {
    pause: jest.fn().mockReturnValue(Promise.resolve(true)),
    resume: jest.fn().mockReturnValue(Promise.resolve(true)),
  }
  public HeapProfiler = {
    addHeapSnapshotChunk: jest.fn(),
    takeHeapSnapshot: jest.fn().mockReturnValue(Promise.resolve(true)),
    reportHeapSnapshotProgress: jest.fn().mockReturnValue(() => {}),
    startSampling: jest.fn().mockReturnValue(Promise.resolve({})),
    stopSampling: jest.fn().mockReturnValue(Promise.resolve({profile: {}})),
    startTrackingHeapObjects: jest.fn().mockReturnValue(Promise.resolve({})),
    stopTrackingHeapObjects: jest.fn().mockReturnValue(Promise.resolve({}))
  }
  public Profiler = {
    setSamplingInterval: jest.fn().mockReturnValue(Promise.resolve({})),
    start: jest.fn().mockReturnValue(Promise.resolve({})),
    stop: jest.fn().mockReturnValue(Promise.resolve({profile: {nodes: [], startTime: 0, endTime: 0}})),
  }
  public Network = {
    requestWillBeSent: jest.fn().mockReturnValue(() => {}),
    responseReceived: jest.fn().mockReturnValue(() => {}),
    loadingFinished: jest.fn().mockReturnValue(() => {}),
    loadingFailed: jest.fn().mockReturnValue(() => {}),
  }
}
