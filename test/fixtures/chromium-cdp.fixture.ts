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
  }
}
