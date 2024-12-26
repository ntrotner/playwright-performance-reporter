export class Logger {
  /**
   * Dispatch log as info
   *
   * @param message main message
   * @param args meta data
   */
  public static info(message: string, ...arguments_: any[]) {
    console.log(this.prefix, this.getDate(), this.logLevels.info, message, arguments_.join(', '));
  }

  /**
   * Dispatch log as warning
   *
   * @param message main message
   * @param args meta data
   */
  public static warning(message: string, ...arguments_: any[]) {
    console.log(this.prefix, this.getDate(), this.logLevels.warning, message, arguments_.join(', '));
  }

  /**
   * Dispatch log as error
   *
   * @param message main message
   * @param args meta data
   */
  public static error(message: string, ...arguments_: any[]) {
    console.log(this.prefix, this.getDate(), this.logLevels.error, message, arguments_.join(', '));
  }

  /**
   * General prefix for every log
   */
  private static readonly prefix = '[PerformanceLogger]';

  /**
   * Supported log levels
   */
  private static readonly logLevels = {
    info: '[info]',
    warning: '[warning]',
    error: '[error]',
  };

  /**
   * Returns date for logging
   */
  private static getDate(): string {
    return `[${(new Date()).toISOString()}]`;
  }
}
