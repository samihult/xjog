import { PersistenceAdapter } from '@samihult/xjog-core-persistence';

import {
  getCorrelationIdentifier,
  LogFields,
  XJogLogEmitter,
} from '@samihult/xjog-util';

import {
  DefaultContext,
  EventObject,
  StateMachine,
  StateSchema,
  Typestate,
} from 'xstate';

import { XJogChartCreationOptions } from './XJogChartCreationOptions';
import { XJogChart } from './XJogChart';
import { XJog } from './XJog';

import {
  XJogMachineOptions,
  ResolvedXJogMachineOptions,
  resolveXJogMachineOptions,
} from './XJogMachineOptions';
import { Mutex, MutexInterface, withTimeout } from 'async-mutex';

/**
 * Options for activity spawning
 */
export interface SpawnOptions {
  autoForward?: boolean;
  sync?: boolean;
}

/**
 * @group XJog
 */
export class XJogMachine<
  TContext = DefaultContext,
  TStateSchema extends StateSchema = StateSchema<TContext>,
  TEvent extends EventObject = EventObject,
  TTypeState extends Typestate<TContext> = {
    value: any;
    context: TContext;
  },
  TEmitted = any,
> extends XJogLogEmitter {
  public readonly component = 'machine';

  /** @private Options after applying defaults and constraints. */
  public readonly options: ResolvedXJogMachineOptions;

  /** @private Persistence adapter from the XJog instance */
  public readonly persistence: PersistenceAdapter;

  private cacheMutex: MutexInterface;
  private chartCacheKeys = new Set<string>();
  private chartCacheStore: {
    [chartId: string]: XJogChart<TContext, TStateSchema, TEvent, TTypeState>;
  } = {};

  public constructor(
    public readonly xJog: XJog,
    public readonly machine: StateMachine<
      TContext,
      TStateSchema,
      TEvent,
      TTypeState
    >,
    options?: XJogMachineOptions,
  ) {
    super();

    this.options = resolveXJogMachineOptions(xJog.options, options);
    this.persistence = xJog.persistence;

    this.cacheMutex = withTimeout(new Mutex(), 300);

    this.trace({ message: 'Instance created', in: 'constructor' });
  }

  /** XJogMachine unique identifier. Same as the provided state machine's id. */
  public get id(): string {
    return this.machine.id;
  }

  private async cleanCache(mutex = true) {
    const releaseMutex = mutex ? await this.cacheMutex.acquire() : null;
    if (this.chartCacheKeys.size > this.options.cacheSize) {
      // Remove oldest
      const chartCacheKeyIterator = this.chartCacheKeys.values();
      const oldestCacheKey = chartCacheKeyIterator.next()?.value;
      if (oldestCacheKey) {
        await this.evictCacheEntry(oldestCacheKey, false);
      }
    }
    releaseMutex?.();
  }

  public async refreshCache(
    chart: XJogChart<TContext, TStateSchema, TEvent, TTypeState>,
    mutex = true
  ): Promise<void> {
    const releaseMutex = mutex ? await this.cacheMutex.acquire() : null;
    this.trace({
      in: 'refreshCache',
      message: 'Refreshing cache',
      chartId: chart.id,
    });
    this.chartCacheKeys.add(chart.id);
    this.chartCacheStore[chart.id] = chart;
    await this.cleanCache(false);
    releaseMutex?.();
  }

  public async evictCacheEntry(chartId: string, mutex = true): Promise<void> {
    const releaseMutex = mutex ? await this.cacheMutex.acquire() : null;
    this.trace({
      in: 'evictCacheEntry',
      message: 'Evicting cache entry',
      chartId,
    });
    if (this.chartCacheStore[chartId]) {
      await this.chartCacheStore[chartId].wait();
      this.chartCacheKeys.delete(chartId);
      delete this.chartCacheStore[chartId];
    }
    releaseMutex?.();
  }

  /**
   * @param options.initialContext Initialize context to this value at chart creation.
   *   Note that the machine definition's default values should be used as the
   *   primary initialization mechanism. Only use this if it's important to
   *   initialize the context to individually varying values, which is often
   *   the case with child charts.
   * @param options.id An **unique** id for this chart. If not set, UUID v4 is used.
   * @param options.parent Optional parent chart for this chart. This is used for
   *   parent–child communication when a parent chart spawns child charts.
   */
  public async createChart(
    options?: XJogChartCreationOptions,
  ): Promise<XJogChart<TContext, TStateSchema, TEvent, TTypeState>> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace(
        { in: 'createChart', chartId: options?.chartId ?? '(generated)' },
        ...args,
      );

    trace('Creating chart');
    const chart = await XJogChart.create<
      TContext,
      TEvent,
      TStateSchema,
      TTypeState,
      TEmitted
    >(this, options);

    await this.refreshCache(chart);

    trace({ message: 'Done', chartId: chart.id });
    return chart;
  }

  /**
   * @param chartId Unique identifier of the chart.
   * @param cid
   */
  public async getChart(
    chartId: string,
    cid = getCorrelationIdentifier(),
  ): Promise<XJogChart<TContext, TStateSchema, TEvent, TTypeState> | null> {
    const logPayload = { in: 'getChart', cid, chartId };

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace(logPayload, ...args);

    const debug = (...args: Array<string | Record<string, unknown>>) =>
      this.debug(logPayload, ...args);

    return this.xJog.timeExecution('machine.get chart', async () => {
      if (this.chartCacheStore[chartId]) {
        trace('Cache hit');
        return this.chartCacheStore[chartId];
      }

      trace('Cache miss, loading');
      const chart = await XJogChart.load<
        TContext,
        TStateSchema,
        TEvent,
        TTypeState
      >(this, chartId);

      if (!chart) {
        debug('Failed to load');
        await this.evictCacheEntry(chartId);
        return null;
      }

      await this.refreshCache(chart);

      trace({ message: 'Done' });
      return chart;
    });
  }

  public async registerExternalId(
    chartId: string,
    key: string,
    value: string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    return this.xJog.registerExternalId(
      { machineId: this.id, chartId },
      key,
      value,
      cid,
    );
  }

  public async dropExternalId(
    key: string,
    value: string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    return this.xJog.dropExternalId(key, value, cid);
  }

  public log(...payloads: Array<string | Partial<LogFields>>) {
    return this.xJog.log(
      {
        component: this.component,
        machineId: this.id,
      },
      ...payloads,
    );
  }
}
