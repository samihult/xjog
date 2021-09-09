import EventEmitter from 'events';

import { logEmit } from './logEmit';
import { LogFields } from './Logging';
import { LogLevels } from './LogLevels';

export abstract class XJogLogEmitter extends EventEmitter {
  /**
   * Implement this in the subclasses for emitting logs with correct
   * component name. Only used for logging.
   */
  public abstract readonly component: string;

  public log(...payloads: Array<string | Partial<LogFields>>) {
    return logEmit.bind(this)({ component: this.component }, ...payloads);
  }

  public error(...payloads: Array<string | Partial<LogFields>>) {
    return this.log({ level: LogLevels.error }, ...payloads);
  }

  public warn(...payloads: Array<string | Partial<LogFields>>) {
    return this.log({ level: LogLevels.warn }, ...payloads);
  }

  public info(...payloads: Array<string | Partial<LogFields>>) {
    return this.log({ level: LogLevels.info }, ...payloads);
  }

  public debug(...payloads: Array<string | Partial<LogFields>>) {
    return this.log({ level: LogLevels.debug }, ...payloads);
  }

  public trace(...payloads: Array<string | Partial<LogFields>>) {
    return this.log({ level: LogLevels.trace }, ...payloads);
  }
}
