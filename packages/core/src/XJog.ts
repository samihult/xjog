import { v4 as uuidV4 } from 'uuid';
import { from, Observable, Subject } from 'rxjs';
import { isPromiseLike, toSCXMLEvent } from 'xstate/lib/utils';
import { PersistenceAdapter } from '@samihult/xjog-core-persistence';

import {
  ChartIdentifier,
  ChartReference,
  getCorrelationIdentifier,
  waitFor,
  ActivityRef,
  isActivityRef,
  XJogLogEmitter,
  UpdateHook,
  XJogStateChange,
} from '@samihult/xjog-util';

import {
  DefaultContext,
  Event,
  EventObject,
  SCXML,
  SpecialTargets,
  State,
  StateMachine,
  StateSchema,
  Typestate,
} from 'xstate';

import { XJogDeferredEventManager } from './XJogDeferredEventManager';
import { XJogActivityManager } from './XJogActivityManager';
import { XJogMachineOptions } from './XJogMachineOptions';
import { XJogStartupManager } from './XJogStartupManager';
import { XJogMachine } from './XJogMachine';
import { XJogChart } from './XJogChart';

import {
  XJogOptions,
  resolveXJogOptions,
  ResolvedXJogOptions,
} from './XJogOptions';

/**
 * Emits following events:
 * - `"ready"` when startup manager has finished
 * - `"log", XJogLogArgument` for logging
 * - `"halt"` when the instance has been brought to a halt
 */
export class XJog extends XJogLogEmitter {
  public readonly component = 'xjog';

  /**
   * The unique id for this instance. Used for instance and
   * ownership tracking in the database.
   */
  public readonly id = uuidV4();

  /**
   * Persistence adapter
   * Read access is required for other classes.
   * @private
   */
  public readonly persistence: PersistenceAdapter;

  /**
   * Options after applying defaults and constraints.
   * Read access is required for other classes.
   * @private
   */
  public readonly options: ResolvedXJogOptions;

  /**
   * Sentenced to death. If set, do nothing to fight back.
   * @ignore
   */
  private isDying = false;

  private cancelDeathNoteListening = () => {
    // No-op that will be replaced by the actual cancelling callback
  };

  /**
   * Map from machine id to corresponding XJog machine.
   * @private
   */
  private readonly registeredMachines = new Map<
    string,
    XJogMachine<any, any, any, any>
  >();

  /**
   * @private
   */
  public changeSubject = new Subject<XJogStateChange>();

  /**
   * @private
   */
  public updateHooks = new Set<UpdateHook>();

  /**
   * Manages the startup sequence.
   * @private
   */
  private readonly startupManager: XJogStartupManager;

  /**
   * Manages deferred events.
   * Read access is required for other classes.
   * @private
   */
  public readonly deferredEventManager: XJogDeferredEventManager;

  /**
   * Activity manager that manages invoked activities.
   * Read access is required for other classes.
   * @private
   */
  public readonly activityManager: XJogActivityManager;

  /**
   * @param options Options
   */
  constructor(options: XJogOptions) {
    super();

    this.options = resolveXJogOptions(options, this.trace.bind(this));

    this.persistence = this.options.persistence;

    this.startupManager = new XJogStartupManager(this);
    this.deferredEventManager = new XJogDeferredEventManager(this);
    this.activityManager = new XJogActivityManager(this);

    this.trace('Instance created', {
      instanceId: this.id,
      in: 'constructor',
    });
  }

  public get dying(): boolean {
    if (this.isDying && !this.startupManager.started) {
      throw new Error('Unexpected condition: dying, but not started');
    }
    return this.isDying;
  }

  protected set dying(isDying: boolean) {
    if (isDying && !this.startupManager.started) {
      throw new Error('Unexpected condition: going to die, but not started');
    }
    this.isDying = isDying;
  }

  /**
   * Register an XState machine with the XJog instance.
   *
   * @param machine The XState machine to register.
   * @param options
   * @param cid Optional correlation identifier for debugging purposes.
   * @throws If there is a machine by same id already registered.
   * @returns The registered machine.
   */
  public async registerMachine<
    TContext = DefaultContext,
    TStateSchema extends StateSchema = any,
    TEvent extends EventObject = EventObject,
    TTypeState extends Typestate<TContext> = {
      value: any;
      context: TContext;
    },
  >(
    machine: StateMachine<TContext, TStateSchema, TEvent, TTypeState>,
    options?: XJogMachineOptions,
    cid = getCorrelationIdentifier(),
  ): Promise<XJogMachine<TContext, TStateSchema, TEvent, TTypeState>> {
    if (this.startupManager.started) {
      throw new Error('Cannot register machines after starting XJog');
    }

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'registerMachine' }, ...args);

    if (this.registeredMachines.has(machine.id)) {
      throw new Error(`Machine ${machine.id} already registered`);
    }

    const xJogMachine = new XJogMachine(this, machine, options);
    this.registeredMachines.set(machine.id, xJogMachine);
    trace('Machine registered', { machineId: machine.id });

    return xJogMachine;
  }

  /**
   * Gets a previously registered XJogMachine.
   *
   * @param id The id of the XJogMachine to retrieve.
   * @throws Error if machine not found (not registered)
   * @returns The machine
   */
  public getMachine<
    TContext = DefaultContext,
    TStateSchema extends StateSchema = any,
    TEvent extends EventObject = EventObject,
    TTypeState extends Typestate<TContext> = {
      value: any;
      context: TContext;
    },
  >(id: string): XJogMachine<TContext, TStateSchema, TEvent, TTypeState> {
    const machine = this.registeredMachines.get(id);

    if (!machine) {
      throw new Error(
        `Machine ${id} not found. Have you registered it properly?`,
      );
    }

    return machine;
  }

  public async start(cid = getCorrelationIdentifier()): Promise<void> {
    if (this.dying) {
      throw new Error('Cannot start because already dying');
    }

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'start' }, ...args);

    trace('Executing the startup sequence');
    await this.startupManager.start(cid);

    trace('Starting deferred event loop');
    await this.deferredEventManager.scheduleUpcoming();

    trace('Start observing death notes');
    this.cancelDeathNoteListening = this.persistence.onDeathNote(
      this.id,
      this.shutdown.bind(this),
    );

    trace('Done');
  }

  /**
   * Enter the shutdown phase and cease all activity.
   *
   * @param cid Optional correlation identifier for debugging purposes.
   */
  public async shutdown(cid = getCorrelationIdentifier()): Promise<void> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'shutdown' }, ...args);

    if (this.dying) {
      trace('Shutdown already in process');
      return;
    }

    if (!this.startupManager.started) {
      trace('Has not started yet');
      return;
    }

    trace('Canceling the death note listener');
    this.cancelDeathNoteListening();

    trace('Preparing to die');
    this.dying = true;

    trace('Removing instance from database');
    await this.persistence.removeInstance(this.id, cid);

    trace('Releasing all deferred events');
    await this.deferredEventManager.releaseAll();

    trace('Stopping all ongoing activities');
    await this.activityManager.stopAllActivities(cid);

    if (!this.startupManager.ready) {
      trace('Startup still working, stopping');
      await this.startupManager.stop();
    }

    const instanceCount = await this.persistence.countAliveInstances();

    // If there are other instances, they should pick up all the charts.
    // Before shutting down we must wait until all charts have been adopted.
    // This way the incoming events get handled – deferred though instead
    // of being sent to the corresponding activities.
    if (instanceCount > 0) {
      trace('Waiting for charts to be adopted by others');
      let ownCharts = await this.persistence.countOwnCharts(this.id);
      while (ownCharts > 0) {
        await waitFor(this.options.shutdown.ownChartPollingFrequency);
        trace('Still waiting...', { ownCharts });
        ownCharts = await this.persistence.countOwnCharts(this.id);
      }
      trace('No more own charts left');
    }

    trace('Emitting halt event');
    this.emit('halt');

    trace('Done');
  }

  /**
   * A shortcut method to get a XJogChart by identifier. Use {@link XJogMachine#getChart}
   * instead if you need properly typed chart instance.
   *
   * @param ref The identifier of the XJogChart to retrieve.
   *   can be called. The callback is called with the context read from the database, and it must
   *   return an object. In both cases the context is patched using `Object.assign`.
   * @param cid Optional correlation identifier for debugging purposes.
   *
   * @returns The chart, if found; `null`, if not found
   */
  public async getChart<
    TContext = DefaultContext,
    TStateSchema extends StateSchema = any,
    TEvent extends EventObject = EventObject,
    TTypeState extends Typestate<TContext> = {
      value: any;
      context: TContext;
    },
  >(
    ref: ChartReference | URL | string,
    cid = getCorrelationIdentifier(),
  ): Promise<XJogChart<TContext, TStateSchema, TEvent, TTypeState> | null> {
    const chartIdentifier = ChartIdentifier.from(ref);

    if (!chartIdentifier) {
      this.trace({ in: 'getChart', ref, cid }, 'Failed to parse reference');
      return null;
    }

    const machine = this.getMachine<TContext, TStateSchema, TEvent, TTypeState>(
      chartIdentifier.machineId,
    );

    const chart = await machine.getChart(chartIdentifier.chartId, cid);

    this.trace(
      { in: 'getChart', ref, cid },
      chart ? 'Chart found' : 'Chart not found',
    );

    return chart;
  }

  public async registerExternalId(
    ref: ChartReference,
    key: string,
    value: string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    return this.timeExecution('xjog.register external id', async () => {
      return this.persistence?.registerExternalId(ref, key, value, cid);
    });
  }

  public async dropExternalId(
    key: string,
    value: string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    return this.timeExecution('xjog.drop external id', async () => {
      this.persistence?.dropExternalId(key, value, cid);
    });
  }

  public async getChartByExternalId<
    TContext = DefaultContext,
    TStateSchema extends StateSchema = any,
    TEvent extends EventObject = EventObject,
    TTypeState extends Typestate<TContext> = {
      value: any;
      context: TContext;
    },
  >(
    key: string,
    value: string,
    cid = getCorrelationIdentifier(),
  ): Promise<XJogChart<TContext, TStateSchema, TEvent, TTypeState> | null> {
    return this.timeExecution('xjog.get chart by external id', async () => {
      const ref = await this.persistence?.getChartByExternalIdentifier(
        key,
        value,
      );

      if (!ref) {
        return null;
      }

      return (await this.getChart(ref, cid)) as XJogChart<
        TContext,
        TStateSchema,
        TEvent,
        TTypeState
      > | null;
    });
  }

  public async stopChart(
    ref: ChartReference,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    return this.timeExecution('xjog.stop chart', async () => {
      const chart = await this.getChart(ref, cid);

      this.trace(chart ? 'Chart found, stopping' : 'Chart not found', {
        cid,
        in: 'stopChart',
        ref,
      });

      await chart?.stop(cid);
    });
  }

  // TODO check the typings
  public async sendEvent<
    TContext = DefaultContext,
    TEvent extends EventObject = EventObject,
  >(
    ref: ChartReference,
    event: Event<TEvent> | SCXML.Event<TEvent>,
    origin?: ChartReference,
    context?: Partial<TContext> | ((context: TContext) => TContext),
    sendId: string | number = uuidV4(),
    cid = getCorrelationIdentifier(),
  ): Promise<State<any> | null> {
    return this.timeExecution('xjog.send event', async () => {
      const chart = await this.getChart(ref, cid);

      if (!chart) {
        return null;
      }

      const scxmlEvent = toSCXMLEvent(event);

      if (origin) {
        scxmlEvent.origin = new ChartIdentifier(origin).uri.toString();
      }

      return await chart.send(scxmlEvent, context, sendId, cid);
    });
  }

  public async sendTo<TEvent extends EventObject = EventObject>(
    to: ActivityRef | ChartReference | SpecialTargets | string | number,
    id: string | number,
    sender: ChartReference,
    event: SCXML.Event<TEvent>,
    context?: any | ((context: any) => any),
    cid = getCorrelationIdentifier(),
  ): Promise<State<any> | null> {
    const eventType = event.name;

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'sendTo' }, ...args);

    const warn = (...args: Array<string | Record<string, unknown>>) =>
      this.warn({ cid, in: 'sendTo' }, ...args);

    trace('Sending event to another chart');

    // Target is the parent chart
    if (to === SpecialTargets.Parent) {
      return this.timeExecution('xjog.send to.parent', async () => {
        trace('Target is the parent chart');

        const senderChart = await this.getChart(sender, cid);

        if (senderChart?.parentRef) {
          trace('Parent chart id resolved', { target: senderChart.parentRef });
        } else {
          warn('Parent chart id not resolved, skipping');
          return null;
        }

        return await this.sendEvent(
          senderChart.parentRef,
          event,
          sender,
          context,
          id,
          cid,
        );
      });
    }

    // Target is an activity
    else if (isActivityRef(to)) {
      return this.timeExecution('xjog.send to.activity', async () => {
        trace('Target is an activity, sending the event');
        if (to.owner) {
          this.activityManager.sendTo(to.owner, to.id, event, cid);
        } else {
          // TODO no owner means an XJogChart
        }
        return null;
      });
    }

    // Target could be either a chart reference or URL, or an activity id
    else {
      const targetChart = ChartIdentifier.from(to);

      if (targetChart) {
        trace('Target identifies a chart', { to });
        return await this.sendEvent(
          targetChart.ref,
          event,
          sender,
          context,
          id,
          cid,
        );
      }

      // Target is probable an activity, check if exists
      else if (
        typeof to === 'string' &&
        typeof this.activityManager.has(sender, to)
      ) {
        return this.timeExecution('xjog.send to.activity', async () => {
          trace('Target is an activity, sending the event');
          this.activityManager.sendTo(sender, to, event, cid);
          return null;
        });
      } else {
        warn('Target was a string but did not match any activity');
      }
    }

    warn('Target did not match anything');

    return null;
  }

  /**
   * @deprecated Use `xJog.getChart().getState()` instead!
   */
  public async read<
    TContext = DefaultContext,
    TStateSchema extends StateSchema = any,
    TEvent extends EventObject = EventObject,
    TTypeState extends Typestate<TContext> = {
      value: any;
      context: TContext;
    },
  >(
    ref: ChartReference,
    cid = getCorrelationIdentifier(),
  ): Promise<State<TContext, TEvent, TStateSchema, TTypeState> | null> {
    return await this.timeExecution('xjog.read', async () => {
      this.trace({ cid, in: 'read', message: 'Reading chart' });

      const chart = await this.getChart<
        TContext,
        TStateSchema,
        TEvent,
        TTypeState
      >(ref); // as XJogChart | null;

      if (!chart) {
        return null;
      }

      return chart.getState();
    });
  }

  public get changes(): Observable<XJogStateChange> {
    return from(this.changeSubject);
  }

  public async waitUntilReady(): Promise<void> {
    return new Promise((resolve) => {
      this.once('ready', resolve);
    });
  }

  public async waitUntilHalted(): Promise<void> {
    return new Promise((resolve) => {
      this.once('halt', resolve);
    });
  }

  // TODO vvv Move these to a monitoring class of its of own. vvv

  private executionDurationHistogramBase = 2;
  private executionDurationHistogramBuckets = 16;

  private executionDurationHistogramBaseLog = Math.log(
    this.executionDurationHistogramBase,
  );

  private executionDurationHistogramBucketCeilingValues = [
    ...new Array(this.executionDurationHistogramBuckets),
  ].map((value, index) => this.executionDurationHistogramBase ** index);

  private executionTimes: { [op: string]: number } = {};
  private executionDurationHistograms: { [op: string]: number[] } = {};

  private getExecutionDurationHistogram(op: string): number[] {
    if (!this.executionDurationHistograms[op]) {
      this.executionDurationHistograms[op] = new Array(
        this.executionDurationHistogramBuckets,
      ).fill(0);
    }

    return this.executionDurationHistograms[op];
  }

  // TODO make option to enable this separately
  private recordExecutionDuration(op: string, duration: number) {
    let bucket;

    const ceilingDuration = Math.ceil(duration);

    if (ceilingDuration <= 0) {
      bucket = 0;
    } else {
      bucket = Math.ceil(
        Math.log(ceilingDuration) / this.executionDurationHistogramBaseLog,
      );
    }

    if (bucket >= this.executionDurationHistogramBuckets) {
      bucket = this.executionDurationHistogramBuckets;
    }

    this.getExecutionDurationHistogram(op)[bucket]++;
    this.executionTimes[op] = (this.executionTimes[op] ?? 0) + duration;
  }

  public timeExecution<T>(op: string, routine: () => T): T {
    // TODO allow enable per options

    const startTime = performance.now();
    const returnValue = routine();

    const done = () =>
      this.recordExecutionDuration(op, performance.now() - startTime);

    if (isPromiseLike(returnValue)) {
      // @ts-ignore Trust that it has `finally`
      return returnValue.finally(done) as unknown as T;
    }

    done();

    return returnValue;
  }

  public getProfilingMetrics(): {
    buckets: number[];
    executions: {
      [op: string]: {
        count: number;
        total: number;
        histogram: number[];
      };
    };
  } {
    return {
      buckets: this.executionDurationHistogramBucketCeilingValues,
      executions: Object.keys(this.executionDurationHistograms)
        .sort()
        .reduce((entry, key) => {
          const histogram = this.executionDurationHistograms[key];

          const count = histogram.reduce((sum, bucket) => sum + bucket, 0);
          const total = this.executionTimes[key];

          return {
            ...entry,
            [key]: {
              count,
              total,
              histogram,
            },
          };
        }, {}),
    };
  }

  /**
   * The given routine is executed as part of the state update transaction.
   * If it fails, the transaction is rolled back and an error is thrown for
   * any send functions.
   *
   * @returns Uninstaller function
   */
  public installUpdateHook(hook: UpdateHook): () => void {
    this.updateHooks.add(hook);
    return () => this.updateHooks.delete(hook);
  }
}
