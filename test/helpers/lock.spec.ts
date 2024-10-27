import {Lock} from '../../src/helpers';

describe('Lock helpers', () => {
  let lock: Lock;

  beforeEach(() => {
    lock = new Lock();
  })

  it('should be created', () => {
    expect(lock).toBeDefined();
  });

  it('should be unlocked by default', () => {
    expect(lock.isLocked()).toEqual(false);
  });

  it('should be locked when lock was called and unlocked on callback', () => {
    const unlock = lock.lock();

    expect(lock.isLocked()).toEqual(true);
    expect(unlock).not.toEqual(false);

    if (unlock) {
      unlock();
    }

    expect(lock.isLocked()).toEqual(false);
  });

  it('should notify waiting subject on unlock event', async () => {
    const unlock = lock.lock();

    expect(lock.isLocked()).toEqual(true);
    const notificationPromise = lock.notifyOnUnlock();
    if (unlock) {
      unlock();
    }

    expect(await notificationPromise).toEqual(undefined);
  });

  it('should not allow lock when already locked', async () => {
    const unlock = lock.lock();

    expect(lock.isLocked()).toEqual(true);
    expect(lock.lock()).toEqual(false);
    if (unlock) {
      unlock();
    }
  });
});

