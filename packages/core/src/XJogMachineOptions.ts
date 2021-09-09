import { pickIntegerOption } from '@samihult/xjog-util';

import { ResolvedXJogOptions } from './XJogOptions';

/**
 * Options for passing to {@link XJogMachine}
 * @group XJog
 */
export type XJogMachineOptions = {
  /**
   * Default maximum allowed time for a chain of events and reactions. This can
   * be overridden chart by chart. Defaults to XJog's `chartMutexTimeout` value.
   */
  chartMutexTimeout?: number;
  /**
   * Maximum number of these charts that will be kept in the in-memory cache.
   * Minimum value is 10, default is 1000.
   */
  cacheSize?: number;
};

/**
 * @group XJog
 */
export type ResolvedXJogMachineOptions = {
  chartMutexTimeout: number;
  cacheSize: number;
};

/**
 * @group XJog
 * @private
 */
export function resolveXJogMachineOptions(
  instanceOptions: ResolvedXJogOptions,
  options?: XJogMachineOptions,
): ResolvedXJogMachineOptions {
  const chartMutexTimeout = pickIntegerOption(
    options?.chartMutexTimeout,
    instanceOptions.chartMutexTimeout,
    50,
  );

  const cacheSize = pickIntegerOption(options?.cacheSize, 1000, 10);

  return {
    chartMutexTimeout,
    cacheSize,
  };
}
