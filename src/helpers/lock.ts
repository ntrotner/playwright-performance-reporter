import {
  Stream,
} from 'node:stream';

/**
 * Events for lock status
 */
enum LockEvents {
  lock,
  unlock,
}

/**
 * Exclusive Lock for a Resource
 */
export class Lock {
  /**
   * Stream of lock status
   */
  private readonly lockStatus = new Stream().setMaxListeners(0);

  /**
   * Track status of lock
   */
  private _isLocked = false;

  /**
   * Requests a lock
   *
   * @returns callback for unlock or false if lock couldn't be performed
   */
  public lock(): (() => void) | false {
    if (this._isLocked) {
      return false;
    }

    this._isLocked = true;
    this.lockStatus.emit('event', LockEvents.lock);
    return () => {
      this.unlock();
    };
  }

  /**
   * Get current lock status
   *
   * @returns lock status
   */
  public isLocked(): boolean {
    return this._isLocked;
  }

  /**
   * Notify caller about unlock status.
   * Does not guarantee that lock can be performed.
   *
   * @returns Promise to notify about unlock event
   */
  public async notifyOnUnlock(): Promise<void> {
    return new Promise(resolve => {
      const callback = (status: LockEvents | undefined) => {
        if (status === LockEvents.unlock) {
          this.lockStatus.removeListener('event', callback);
          resolve();
        }
      };

      this.lockStatus.on('event', callback);
    });
  }

  /**
   * Emit unlock event
   */
  private unlock() {
    this._isLocked = false;
    this.lockStatus.emit('event', LockEvents.unlock);
  }
}
