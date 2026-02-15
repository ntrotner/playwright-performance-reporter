export class LockFixture {
  public lock = jest.fn(() => () => {});
  public isLocked = jest.fn(() => false);
  public notifyOnUnlock = jest.fn(() => Promise.resolve());
}
