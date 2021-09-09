import { PersistenceAdapter } from '@samihult/xjog-core-persistence';
import { pickIntegerOption } from '@samihult/xjog-util';

/**
 * @group XJog
 */
export type XJogOptions = {
  persistence: PersistenceAdapter;
  /**
   * Default maximum allowed time for a chain of events and reactions.
   * This can be overridden machine by machine and chart by chart.
   * Defaults to 2000 ms.
   */
  chartMutexTimeout?: number;
  startup?: {
    /** How often to poll for unadopted charts */
    adoptionFrequency?: number;
    /** How long to wait until forcibly adopt old instance's charts. */
    gracePeriod?: number;
  };
  deferredEvents?: {
    /** Number of deferred events to process at a time */
    batchSize?: number;
    /** Interval for scheduling the next read */
    interval?: number;
    /** Milliseconds to look ahead for upcoming events */
    lookAhead?: number;
  };
  shutdown?: {
    /** How often to poll for own charts during the shutdown */
    ownChartPollingFrequency?: number;
  };
};

/**
 * XJog options after resolving defaults and constraints
 * @group XJog
 */
export type ResolvedXJogOptions = {
  persistence: PersistenceAdapter;
  chartMutexTimeout: number;
  startup: {
    adoptionFrequency: number;
    gracePeriod: number;
  };
  deferredEvents: {
    batchSize: number;
    interval: number;
    lookAhead: number;
  };
  shutdown: {
    ownChartPollingFrequency: number;
  };
};

/**
 * @group XJog
 * @private
 */
export function resolveXJogOptions(
  options: XJogOptions,
  trace: (...args: any[]) => void,
): ResolvedXJogOptions {
  const chartMutexTimeout = pickIntegerOption(
    options.chartMutexTimeout,
    2000,
    50,
    trace,
  );

  return {
    persistence: options.persistence,
    chartMutexTimeout,
    startup: resolveXJogStartupOptions(options.startup, trace),
    deferredEvents: resolveXJogDeferredEventOptions(
      options.deferredEvents,
      trace,
    ),
    shutdown: resolveShutdownOptions(options.shutdown, trace),
  };
}

/**
 * @group XJog
 * @ignore
 */
export function resolveXJogStartupOptions(
  options: XJogOptions['startup'] | undefined | null,
  trace: (...args: any[]) => void,
): ResolvedXJogOptions['startup'] {
  const adoptionFrequency = pickIntegerOption(
    options?.adoptionFrequency,
    2 * 1000,
    10,
    trace,
  );

  const gracePeriod = pickIntegerOption(
    options?.gracePeriod,
    30 * 1000,
    2.5 * adoptionFrequency,
    trace,
  );

  return {
    adoptionFrequency,
    gracePeriod,
  };
}

/**
 * @group XJog
 * @ignore
 */
export function resolveXJogDeferredEventOptions(
  options: XJogOptions['deferredEvents'] | undefined | null,
  trace: (...args: any[]) => void,
): ResolvedXJogOptions['deferredEvents'] {
  const batchSize = pickIntegerOption(options?.batchSize, 100, 1, trace);
  const interval = pickIntegerOption(options?.interval, 30 * 1000, 50, trace);
  const lookAhead = pickIntegerOption(
    options?.lookAhead,
    30 * 1000,
    interval,
    trace,
  );

  return {
    batchSize,
    interval,
    lookAhead,
  };
}

/**
 * @group XJog
 * @ignore
 */
export function resolveShutdownOptions(
  options: XJogOptions['shutdown'] | undefined | null,
  trace: (...args: any[]) => void,
): ResolvedXJogOptions['shutdown'] {
  const ownChartPollingFrequency = pickIntegerOption(
    options?.ownChartPollingFrequency,
    500,
    50,
    trace,
  );

  return {
    ownChartPollingFrequency,
  };
}
