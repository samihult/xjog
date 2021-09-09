import EventEmitter from 'events';

import { LogLevels } from './LogLevels';

export type CommonLogFields = { level: number; message: string };

export function logEmit<LogFields extends Record<string, unknown>>(
  this: EventEmitter,
  ...payloads: Array<string | Partial<LogFields & CommonLogFields>>
): void | typeof logEmit {
  let message = null;

  const payload: Partial<LogFields & CommonLogFields> = {};

  for (const part of payloads) {
    if (typeof part === 'string') {
      message = part;
    } else {
      if (part.message) {
        message = part.message;
      }
      Object.assign(payload, part);
    }
  }

  if (message) {
    this.emit('log', {
      message,
      level: payload.level ?? LogLevels.info,
      ...payload,
    });
  }

  return (
    ...additionalPayloads: Array<string | Partial<LogFields & CommonLogFields>>
  ) => {
    return logEmit.bind(this)(...payloads, ...additionalPayloads);
  };
}
