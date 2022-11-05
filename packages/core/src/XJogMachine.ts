import { v4 as uuidV4 } from 'uuid';
import { PersistenceAdapter } from '@samihult/xjog-core-persistence';

import {
  ChartReference,
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

import { XJogChartOptions } from './XJogChartOptions';
import { XJogChart } from './XJogChart';
import { XJog } from './XJog';

import {
  XJogMachineOptions,
  ResolvedXJogMachineOptions,
  resolveXJogMachineOptions,
} from './XJogMachineOptions';

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

    this.trace({ message: 'Instance created', in: 'constructor' });
  }

  /** XJogMachine unique identifier. Same as the provided state machine's id. */
  public get id(): string {
    return this.machine.id;
  }

  private cleanCache() {
    if (this.chartCacheKeys.size > this.options.cacheSize) {
      // Remove oldest
      const chartCacheKeyIterator = this.chartCacheKeys.values();
      const oldestCacheKey = chartCacheKeyIterator.next()?.value;
      if (oldestCacheKey) {
        this.evictCacheEntry(oldestCacheKey);
      }
    }
  }

  public refreshCache(
    chart: XJogChart<TContext, TStateSchema, TEvent, TTypeState>,
  ): void {
    this.trace({
      in: 'refreshCache',
      message: 'Refreshing cache',
      chartId: chart.id,
    });
    this.chartCacheKeys.add(chart.id);
    this.chartCacheStore[chart.id] = chart;
    this.cleanCache();
  }

  public evictCacheEntry(chartId: string): void {
    this.trace({
      in: 'evictCacheEntry',
      message: 'Evicting cache entry',
      chartId,
    });
    this.chartCacheKeys.delete(chartId);
    delete this.chartCacheStore[chartId];
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
    chartId: string = uuidV4(),
    options?: XJogChartOptions,
  ): Promise<XJogChart<TContext, TStateSchema, TEvent, TTypeState>> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ in: 'createChart', chartId }, ...args);

    trace('Creating chart');
    const chart = await XJogChart.create<
      TContext,
      TEvent,
      TStateSchema,
      TTypeState,
      TEmitted
    >(this, {
      ...options,
      id: chartId,
      parentRef: options?.parentRef,
      initialContext: options?.initialContext,
    });

    this.refreshCache(chart);

    trace({ message: 'Done' });
    return chart;
  }

  /**
   * @param chartId Unique identifier of the chart.
   * @param contextPatch
   * @param options
   */
  public async getChart(
    chartId: string,
    contextPatch?: any | ((context: TContext) => TContext),
    options?: XJogChartOptions,
  ): Promise<XJogChart<TContext, TStateSchema, TEvent, TTypeState> | null> {
    const logPayload = { in: 'getChart', chartId };

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
      >(this, chartId, contextPatch, options);

      if (!chart) {
        debug('Failed to load');
        this.evictCacheEntry(chartId);
        return null;
      }

      this.refreshCache(chart);

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
