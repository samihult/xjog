import { pickIntegerOption, ChartReference } from '@samihult/xjog-util';

import { ResolvedXJogMachineOptions } from './XJogMachineOptions';
import { ResolvedXJogOptions } from './XJogOptions';

/**
 * @group XJog
 */
export type XJogChartOptions<TContext = any> = {
  /**
   * Default maximum allowed time for a chain of events and reactions.
   * Defaults to XJog machine's `chartMutexTimeout` value.
   */
  chartMutexTimeout?: number;

  id?: string;
  parentRef?: ChartReference;
  initialContext?: TContext;
};

/**
 * @group XJog
 */
export type ResolvedXJogChartOptions = {
  chartMutexTimeout: number;
};

/**
 * @group XJog
 * @private
 */
export function resolveXJogChartOptions(
  instanceOptions: ResolvedXJogOptions,
  machineOptions: ResolvedXJogMachineOptions,
  options?: XJogChartOptions,
): ResolvedXJogChartOptions {
  const chartMutexTimeout = pickIntegerOption(
    options?.chartMutexTimeout,
    machineOptions.chartMutexTimeout,
    50,
  );

  return {
    chartMutexTimeout,
  };
}
