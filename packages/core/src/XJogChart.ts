import { v4 as uuidV4 } from 'uuid';
import { doneInvoke, getActionFunction } from 'xstate/lib/actions';
import { Mutex, MutexInterface, withTimeout } from 'async-mutex';
import { concat, Observable, of, map, from, filter } from 'rxjs';

import {
  getCorrelationIdentifier,
  ChartIdentifier,
  ChartReference,
  ActivityRef,
  LogFields,
  XJogLogEmitter,
  XJogStateChange,
} from '@samihult/xjog-util';

import {
  PersistenceAdapter,
  PersistedDeferredEvent,
} from '@samihult/xjog-core-persistence';

import {
  ActionObject,
  ActionTypes,
  ActivityActionObject,
  AnyEventObject,
  CancelAction,
  Event,
  EventObject,
  Interpreter,
  InvokeCallback,
  InvokeDefinition,
  Observer,
  SCXML,
  SendActionObject,
  Spawnable,
  State,
  StateMachine,
  StateNodeConfig,
  StateSchema,
  Subscribable,
  Subscription,
  Typestate,
} from 'xstate';

import {
  isFunction,
  isMachine,
  isObservable,
  isPromiseLike,
  mapContext,
  toEventObject,
  toInvokeSource,
  toObserver,
  toSCXMLEvent,
} from 'xstate/lib/utils';

import { SpawnOptions, XJogMachine } from './XJogMachine';
import { XJog } from './XJog';

import {
  ResolvedXJogChartOptions,
  resolveXJogChartOptions,
  XJogChartCreationOptions,
} from './XJogChartCreationOptions';

export type XJogSendAction<
  TContext = any,
  TEvent extends EventObject = EventObject,
  TSentEvent extends EventObject = AnyEventObject,
> = Omit<SendActionObject<TContext, TEvent, TSentEvent>, 'to'> & {
  to?: string | number | ActivityRef | ChartReference;
};

/**
 * This class represents an interface to a single chart instance.
 * It will take care of sending events, state transitions etc.
 *
 * Longer-living matters are taken care of by {@link XJog}, which
 * can then, for example, limit the number of scheduled events
 * system-wide.
 *
 * Since state transitions need to take place in strict order,
 * any event sending must acquire a mutex lease. A single event
 * may cause other events to be sent as well. For that reason
 * the mutex acquisition has a configurable timeout. It will
 * typically fire, when there are infinite loops in the charts.
 * Tune the mutex timeout so that it allows for suitably lengthy,
 * normative event and transition chains.
 *
 * @group XJog
 */
export class XJogChart<
  TContext = any,
  TStateSchema extends StateSchema = any,
  TEvent extends EventObject = EventObject,
  TTypeState extends Typestate<TContext> = {
    value: any;
    context: TContext;
  },
  TEmitted = any,
> extends XJogLogEmitter {
  public readonly component = 'chart';

  public readonly xJog: XJog;
  private readonly persistence: PersistenceAdapter;

  private stopping = false;

  public readonly chartMutex: MutexInterface;

  // private updateSubject = new Subject<
  //   State<TContext, TEvent, TStateSchema, TTypeState>
  // >();

  /**
   * @param xJogMachine
   * @param parentRef Optional parent chart or activity that spawned this chart.
   * @param id Unique identifier for the chart. Defaults to a UUID v4.
   * @param state
   * @param options
   */
  private constructor(
    private xJogMachine: XJogMachine<
      TContext,
      TStateSchema,
      TEvent,
      TTypeState
    >,
    public readonly id: string = uuidV4(),
    public readonly parentRef: ChartReference | null,
    private state: State<TContext, TEvent, TStateSchema, TTypeState>,
    private readonly options: ResolvedXJogChartOptions,
  ) {
    super();

    this.options = resolveXJogChartOptions(
      xJogMachine.xJog.options,
      xJogMachine.options,
    );

    this.xJog = xJogMachine.xJog;
    this.persistence = xJogMachine.persistence;

    // TODO make this configurable separately
    this.chartMutex = withTimeout(new Mutex(), this.options.chartMutexTimeout);

    this.trace({ message: 'Instance created', in: 'constructor' });
  }

  public getState(): State<TContext, TEvent, TStateSchema, TTypeState> {
    return this.state;
  }

  /**
   * Load a XJog chart from the database
   * @param xJogMachine
   * @param options
   */
  public static async create<
    TContext,
    TEvent extends EventObject,
    TStateSchema extends StateSchema<any>,
    TTypeState extends Typestate<any>,
    TEmitted,
  >(
    xJogMachine: XJogMachine<
      TContext,
      TStateSchema,
      TEvent,
      TTypeState,
      TEmitted
    >,
    options?: XJogChartCreationOptions<TContext>,
  ): Promise<XJogChart<TContext, TStateSchema, TEvent, TTypeState, TEmitted>> {
    return xJogMachine.xJog.timeExecution('chart.create', async () => {
      const instanceId = xJogMachine.xJog.id;

      const ref: ChartReference = {
        machineId: xJogMachine.id,
        chartId: options?.chartId ?? uuidV4(),
      };

      const parentRef: ChartReference | null = options?.parentRef ?? null;

      const context = Object.assign(
        {},
        xJogMachine.machine.initialState.context,
        options?.initialContext ?? {},
      );

      // TODO check if could do with static `inert` or something

      const stateMachine = xJogMachine.xJog.timeExecution(
        'chart.create.configure machine',
        () => xJogMachine.machine.withContext(context),
      );

      //- seems to be needed - TODO verify that is not needed: in the XState interpreted this
      // is only called if the state is initialized with some OTHER state
      // like we could when READING this from the database
      const state = xJogMachine.xJog.timeExecution(
        'chart.create.resolve state',
        () => stateMachine.resolveState(stateMachine.initialState),
      );

      const change: XJogStateChange = {
        type: 'create',
        ref,
        parentRef,
        event: toEventObject(state.event),
        old: null,
        new: {
          value: state.value,
          context: state.context,
        },
      };

      for (const hook of xJogMachine.xJog.updateHooks) {
        await xJogMachine.xJog.timeExecution(
          'chart.create.call hook',
          async () => {
            await hook(change);
          },
        );
      }

      await xJogMachine.xJog.timeExecution('chart.create.store', async () => {
        await xJogMachine.persistence?.createChart<
          TContext,
          TEvent,
          TStateSchema,
          TTypeState
        >(instanceId, ref, state, parentRef);
      });

      const chart = xJogMachine.xJog.timeExecution(
        'chart.create.instantiate',
        () =>
          new XJogChart<TContext, TStateSchema, TEvent, TTypeState, TEmitted>(
            xJogMachine,
            ref.chartId,
            options?.parentRef ?? null,
            state,
            resolveXJogChartOptions(
              xJogMachine.xJog.options,
              xJogMachine.options,
            ),
          ),
      );

      // chart.updateSubject.next(state);
      xJogMachine.xJog.changeSubject.next(change);

      await xJogMachine.xJog.timeExecution(
        'chart.create.execute actions',
        async () => await chart.executeActions(state, false, false),
      );

      return chart;
    });
  }

  public static async load<
    TContext = any,
    TStateSchema extends StateSchema = any,
    TEvent extends EventObject = EventObject,
    TTypeState extends Typestate<TContext> = {
      value: any;
      context: TContext;
    },
    TEmitted = any,
  >(
    xJogMachine: XJogMachine<TContext, TStateSchema, TEvent, TTypeState>,
    chartId: string,
  ): Promise<XJogChart<
    TContext,
    TStateSchema,
    TEvent,
    TTypeState,
    TEmitted
  > | null> {
    return xJogMachine.xJog.timeExecution('chart.load', async () => {
      const ref = {
        machineId: xJogMachine.id,
        chartId,
      };

      const chart = await xJogMachine.persistence?.loadChart<
        TContext,
        TEvent,
        TStateSchema,
        TTypeState
      >(ref);

      if (!chart) {
        return null;
      }

      const { state, parentRef } = chart;

      return new XJogChart<
        TContext,
        TStateSchema,
        TEvent,
        TTypeState,
        TEmitted
      >(
        xJogMachine,
        chartId,
        parentRef,
        state,
        resolveXJogChartOptions(xJogMachine.xJog.options, xJogMachine.options),
      );
    });
  }

  private async acquireMutex(
    cid = getCorrelationIdentifier(),
  ): Promise<() => Promise<void>> {
    const logPayload = {
      cid,
      in: 'acquireMutex',
      ref: this.ref,
    };

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace(logPayload, ...args);

    try {
      const releaseMutex = await this.chartMutex.acquire();
      trace({ message: 'Mutex acquired' });

      return async () => {
        releaseMutex();
        trace({ message: 'Mutex released' });
      };
    } catch (error) {
      trace({
        message:
          'Failed to acquire mutex lease. ' +
          'This indicates a problem with the chart, an eternal loop for example. ' +
          'Shutting down.',
      });

      try {
        await this.xJog.shutdown(cid);

        return async () => {
          // No mutex, no release in nested calls
        };
      } catch (shutdownError) {
        const { message } = shutdownError as Error;

        throw new Error(
          `Failed to shut down after mutex failure, details:\n` +
            JSON.stringify(logPayload, null, 2) +
            '\nError:\n' +
            message,
        );
      }
    }
  }

  /**
   * This should never be called directly. It's called when a new chart is
   * created or an old one is adopted.
   * @param cid Optional correlation identifier for debugging purposes
   */
  public async runStep(cid = getCorrelationIdentifier()) {
    return this.xJog.timeExecution('chart.run step', async () => {
      const trace = (...args: Array<string | Record<string, unknown>>) =>
        this.trace({ cid, in: 'runStep' }, ...args);

      const stateBeforeTransition = this.state.value;
      const contextBeforeTransition = this.state.context;

      trace({ message: 'Executing actions' });
      await this.executeActions(this.state, true, false, cid);

      // trace({ message: 'Notifying subscribers' });
      // this.xJog.observerNextValue(
      //   { ref: this.ref, state: this.state as unknown as State<any> },
      //   cid,
      // );

      trace({ message: 'Emitting next value' });
      // this.updateSubject.next(this.state);

      const change: XJogStateChange = {
        type: 'create',
        ref: this.ref,
        parentRef: this.parentRef,
        event: toEventObject(this.state.event),
        old: {
          value: stateBeforeTransition,
          context: contextBeforeTransition,
        },
        new: {
          value: this.state.value,
          context: this.state.context,
        },
      };

      this.xJogMachine.xJog.changeSubject.next(change);

      trace({ message: 'Done' });
    });
  }

  public get ref(): ChartReference {
    return {
      machineId: this.xJogMachine.id,
      chartId: this.id,
    };
  }

  public get href(): string {
    return new ChartIdentifier(this.ref).uri.href;
  }

  public async destroy({
    cid = getCorrelationIdentifier(),
  } = {}): Promise<void> {
    this.xJogMachine.evictCacheEntry(this.id);

    return this.xJog.timeExecution('chart.destroy', async () => {
      const trace = (...args: Array<string | Record<string, unknown>>) =>
        this.trace({ cid, in: 'destroy' }, ...args);

      trace({ message: 'Entering stopping state' });
      this.stopping = true;

      const change: XJogStateChange = {
        type: 'delete',
        ref: this.ref,
        parentRef: this.parentRef,
        event: null,
        old: {
          value: this.state.value,
          context: this.state.context,
        },
        new: null,
      };

      const releaseMutex = await this.xJog.timeExecution(
        'chart.destroy.acquire mutex',
        async () => this.acquireMutex(),
      );

      for (const hook of this.xJog.updateHooks) {
        await this.xJog.timeExecution('chart.destroy.call hook', async () => {
          await hook(change);
        });
      }

      trace({ message: 'Destroying persisted chart' });
      await this.persistence?.destroyChart(this.ref, cid);

      await releaseMutex();

      this.xJog.changeSubject.next(change);
      // this.updateSubject.complete();
    });
  }

  // TODO Drop in favour of just reading the state
  /** @deprecated Use {@link getState} instead! */
  public async read(
    cid = getCorrelationIdentifier(),
    connection?: unknown,
  ): Promise<State<TContext, TEvent, any, any> | null> {
    this.trace({
      type: 'warning',
      cid,
      in: 'read',
      message: 'Read (deprecated!)',
    });

    return this.state;
  }

  /**
   * @param event XState event to send.
   * @param context Fields to patch the context. Either an object or an updater callback function.
   *   can be called. The callback is called with the context read from the database, and it must
   *   return an object. Object is patched using `Object.assign`, function must return a full context.
   * @param actionId Id of the send action, has to be unique, see `SendActionObject`
   * @param cid Optional correlation identifier for debugging purposes
   */
  public async send(
    event: Event<TEvent> | SCXML.Event<TEvent>,
    context?: Partial<TContext> | ((context: TContext) => TContext),
    actionId: string | number = uuidV4(),
    cid = getCorrelationIdentifier(),
  ): Promise<State<TContext, TEvent, TStateSchema, TTypeState> | null> {
    const logPayload = { cid, in: 'send', id: actionId };

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'send', id: actionId }, ...args);

    const error = (...args: Array<string | Record<string, unknown>>) =>
      this.error({ cid, in: 'send', id: actionId }, ...args);

    return this.xJog.timeExecution('chart.send', async () => {
      const scxmlEvent = toSCXMLEvent(event);
      trace({ message: 'Sending event', eventName: scxmlEvent.name });

      if (this.stopping || this.xJog.dying) {
        trace({ message: 'Stopping or dying, so deferring this event' });
        await this.xJog.deferredEventManager.defer(
          {
            // TODO what should we pass as eventId?
            eventId: actionId,
            // TODO should we also pass actionId and sendId
            ref: this.ref,
            delay: 0,
            event: scxmlEvent,
          },
          cid,
        );

        return null;
      }

      const releaseMutex = await this.xJog.timeExecution(
        'chart.send.acquire mutex',
        async () => this.acquireMutex(cid),
      );

      trace({ message: 'Saving the current state' });
      const stateBeforeTransition = JSON.parse(
        JSON.stringify(this.state.value),
      );
      const contextBeforeTransition = JSON.parse(
        JSON.stringify(this.state.context),
      );

      try {
        if (context) {
          if (isFunction(context)) {
            trace({ message: 'Reducing context' });
            this.state.context = context(
              JSON.parse(JSON.stringify(this.state.context)),
            );
          } else {
            trace({ message: 'Patching context' });
            this.state.context = Object.assign({}, this.state.context, context);
          }
        }

        this.state = this.xJog.timeExecution('chart.send.state after', () => {
          trace({ message: 'Resolving next state' });
          return this.xJogMachine.machine.transition(
            this.state,
            scxmlEvent,
            this.state.context,
          );
        });

        this.xJogMachine.refreshCache(this);

        const change: XJogStateChange = {
          type: 'update',
          ref: this.ref,
          parentRef: this.parentRef,
          event: toEventObject(scxmlEvent.data),
          old: {
            value: stateBeforeTransition,
            context: contextBeforeTransition,
          },
          new: {
            value: JSON.parse(JSON.stringify(this.state.value)),
            context: JSON.parse(JSON.stringify(this.state.context)),
          },
        };

        for (const hook of this.xJog.updateHooks) {
          await this.xJog.timeExecution('chart.send.call hook', async () => {
            await hook(change);
          });
        }

        await this.xJog.timeExecution('chart.send.update chart', async () => {
          trace({ message: 'Updating chart' });
          await this.persistence.updateChart(this.ref, this.state, cid);
        });

        this.xJog.changeSubject.next(change);

        await this.xJog.timeExecution(
          'chart.send.execute actions',
          async () => {
            trace({ message: 'Executing actions' });
            await this.executeActions(this.state, false, true, cid);
          },
        );
      } catch (err) {
        error('Failed to send event, returning null', { err });
        return null;
      } finally {
        await releaseMutex();
      }

      if (this.state.done && this.parentRef) {
        // trace({ message: 'Notifying done listeners' });
        // this.xJog.chartDone(this.ref, doneData);

        // if (this.parentRef) {
        trace({ message: 'Final state reached' });
        const doneData = this.resolveDoneData(this.state, cid);

        trace({ message: 'Notifying the owner that chart is done' });

        // TODO should probably defer this event
        await this.xJog.sendEvent(
          this.parentRef,
          doneInvoke(this.id, doneData),
          undefined,
          undefined,
          cid,
        );
        // }
      }

      trace({ message: 'Done' });

      this.xJog.timeExecution('chart.send.auto-forward', () => {
        this.xJog.activityManager.sendAutoForwardEvent(this.ref, scxmlEvent);
      });

      return this.state;
    });
  }

  private resolveDoneData(
    state: State<TContext, TEvent, TStateSchema, TTypeState>,
    cid = getCorrelationIdentifier(),
  ): any {
    return this.xJog.timeExecution('chart.resolve done data', async () => {
      const trace = (...args: Array<string | Record<string, unknown>>) =>
        this.trace({ cid, in: 'resolveDoneData' }, ...args);

      const topLevelStates = Object.entries<
        StateNodeConfig<TContext, TStateSchema, TEvent>
      >(
        (this.xJogMachine.machine.config.states ?? {}) as {
          [key: string]: StateNodeConfig<TContext, TStateSchema, TEvent>;
        },
      );

      const [, finalStateNode] =
        topLevelStates
          .filter(([, stateNode]) => stateNode.type === 'final')
          .find(([stateName]) => state.matches(stateName)) ?? [];

      if (!finalStateNode) {
        throw new Error('Failed to find final state node');
      }

      trace({ message: 'Final state node resolved', node: finalStateNode });

      return finalStateNode.data
        ? mapContext(
            finalStateNode.data,
            state.context,
            toSCXMLEvent(state.event),
          )
        : undefined;
    });
  }

  /**
   * @private
   * @param state
   * @param rehydrating
   * @param nested
   * @param cid
   */
  public async executeActions(
    state: State<TContext, TEvent, TStateSchema, TTypeState>,
    rehydrating = false,
    nested = false,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    return this.xJog.timeExecution('chart.execute actions', async () => {
      for (const action of state.actions) {
        // If rehydrating, we must not run the init actions again
        if (rehydrating && action.type === ActionTypes.Init) {
          continue;
        }

        try {
          await this.executeAction(
            state,
            action,
            nested,
            cid,
            // transactionConnectionForNesting,
          );
        } catch (error) {
          this.warn({
            message: 'Failed to execute action',
            error,
            action,
          });
          throw error;
        }
      }
    });
  }

  private async executeAction(
    state: State<TContext, TEvent, TStateSchema, TTypeState>,
    action: ActionObject<TContext, TEvent>,
    nested = false,
    cid = getCorrelationIdentifier(),
    // transactionConnectionForNesting?: unknown,
  ): Promise<void> {
    await this.xJog.timeExecution('chart.execute action', async () => {
      const machine = this.xJogMachine.machine;
      const { context, _event: scxmlEvent } = state;

      const logPayload = {
        cid,
        in: 'executeAction',
        actionType: action.type,
      };

      const trace = (...args: Array<string | Record<string, unknown>>) =>
        this.trace(logPayload, ...args);

      const warn = (...args: Array<string | Record<string, unknown>>) =>
        this.warn(logPayload, ...args);

      trace({ message: 'Executing action' });

      const actionOrExec =
        action.exec || getActionFunction(action.type, machine.options.actions);

      const exec = isFunction(actionOrExec)
        ? actionOrExec
        : actionOrExec
        ? actionOrExec.exec
        : action.exec;

      // If it's immediately executable, run it...
      if (exec) {
        return this.xJog.timeExecution('chart.execute action.immediate', () => {
          trace({ message: 'Immediately executable, running' });
          try {
            (exec as any)(context, scxmlEvent.data, {
              action,
              state,
              _event: scxmlEvent,
            });
          } catch (error) {
            warn({ message: 'Failed to execute', error });
          }
          trace({ message: 'Done' });
        });
      }

      switch (action.type) {
        case ActionTypes.Send: {
          await this.xJog.timeExecution(
            'chart.execute action.send',
            async () => {
              const delay = action.delay ?? 0;

              const PersistedDeferredEvent: Omit<
                PersistedDeferredEvent,
                'id' | 'eventId' | 'timestamp' | 'due'
              > & {
                eventId: string | number;
              } = {
                ref: this.ref,
                event: action._event,
                // TODO what should we send as eventId
                eventId: action.id ?? uuidV4(),
                // TODO should we also send actionId and sendId?
                eventTo: action.to ?? null,
                delay,
                lock: null,
              };

              trace({ message: 'Deferring event sending action' });
              await this.xJog.deferredEventManager.defer(
                PersistedDeferredEvent,
                cid,
              );

              // if (sendAction.to) {
              //   trace({ message: 'Sending event elsewhere', to: sendAction.to });
              //   await this.sendTo(
              //     sendAction.id,
              //     sendAction._event,
              //     sendAction.to,
              //     cid,
              //   );
              //
              //   break;
              // }
            },
          );
          break;
        }

        case ActionTypes.Cancel: {
          await this.xJog.timeExecution(
            'chart.execute action.cancel',
            async () => {
              const sendId = (action as CancelAction).sendId;
              trace({ message: 'Canceling event', sendId });
              await this.xJog.deferredEventManager.cancel(sendId, cid);
            },
          );
          break;
        }

        case ActionTypes.Start: {
          await this.xJog.timeExecution(
            'chart.execute action.start',
            async () => {
              const activity = (
                action as ActivityActionObject<TContext, TEvent>
              ).activity as InvokeDefinition<TContext, TEvent>;
              const activityId = activity.id;

              trace({ message: 'Starting activity', activityId });

              // If the activity will be stopped right after it's started
              // (such as in transient states) don't bother starting the activity.
              if (state.activities[activity.id || activity.type]) {
                // Invoked services
                if (activity.type === ActionTypes.Invoke) {
                  trace({ message: 'Invoking service', activityId });
                  await this.invokeService(action.id, state, activity, cid);
                }

                // Spawn
                else {
                  // TODO

                  warn({
                    message: 'Tried to spawn, not supported yet',
                    activityId,
                  });

                  throw new Error(
                    'You need to use xjog-provided `spawn`, which is not yet available',
                  );

                  // this.spawnActivity(activity);
                }
              }
            },
          );
          break;
        }

        case ActionTypes.Stop: {
          await this.xJog.timeExecution(
            'chart.execute action.stop',
            async () => {
              const activity = (
                action as ActivityActionObject<TContext, TEvent>
              ).activity as InvokeDefinition<TContext, TEvent>;

              trace({ message: 'Stopping activity', id: activity.id });
              await this.xJog.activityManager.stopActivity(
                this.ref,
                activity.id,
                cid,
              );
            },
          );
          break;
        }

        case ActionTypes.Log: {
          await this.xJog.timeExecution('chart.execute action.log', () => {
            const { label, value } = action;
            const message = isFunction(value) ? value() : value;
            this.info(message, { label });
          });
          break;
        }

        default:
          warn({ message: 'Unknown action type' });
          break;
      }

      trace({ message: 'Done' });
    });
  }

  private async invokeService(
    actionId: string,
    state: State<TContext, TEvent, TStateSchema, TTypeState>,
    activity: InvokeDefinition<TContext, TEvent>,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const activityId = activity.id;

    const logPayload = { cid, in: 'invokeService', actionId, activityId };

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace(logPayload, ...args);

    const warn = (...args: Array<string | Record<string, unknown>>) =>
      this.warn(logPayload, ...args);

    const error = (...args: Array<string | Record<string, unknown>>) =>
      this.error(logPayload, ...args);

    const alreadyOngoing = await this.xJog.activityManager.activityOngoing(
      this.ref,
      activityId,
    );

    if (alreadyOngoing) {
      trace({ message: 'Activity already ongoing, stopping first' });
      await this.xJog.activityManager.stopActivity(this.ref, activityId);
    }

    trace({ message: 'Resolving invoke source' });
    const invokeSource = toInvokeSource(activity.src);

    const serviceCreator =
      this.xJogMachine.machine.options.services?.[invokeSource.type];

    if (!serviceCreator) {
      warn({ message: 'Service creator not defined' });
      return;
    }

    trace({ message: 'Resolving service data' });
    const resolvedData = activity.data
      ? mapContext(activity.data, state.context, state._event)
      : undefined;

    if (typeof serviceCreator === 'string') {
      error({
        message: 'Service creator is a string',
        serviceCreator,
      });
      throw new Error(`Service creator "${serviceCreator}" is a string`);
    }

    let spawnable: Spawnable = isFunction(serviceCreator)
      ? (serviceCreator as any)(state.context, state._event.data, {
          data: resolvedData,
          src: invokeSource,
        })
      : serviceCreator;

    if (!spawnable) {
      warn({
        message: 'Service creator is function but did not return spawnable',
      });
      return;
    }

    const spawnOptions: SpawnOptions = {};

    if (isMachine(spawnable)) {
      trace({ message: 'Spawning a machine', spawnableId: spawnable.id });

      spawnable = resolvedData
        ? spawnable.withContext(resolvedData)
        : spawnable;
    }

    spawnOptions.autoForward =
      'autoForward' in activity ? activity.autoForward : !!activity.forward;

    trace({ message: 'Spawning' });
    const activityRef = await this.spawn(
      activityId,
      spawnable,
      spawnOptions,
      cid,
    );

    if (activityRef) {
      trace({ message: 'Registering as activity', id: activityRef.id });
      await this.xJog.activityManager.registerActivity(activityRef);
    }
  }

  /**
   * @returns `null`, if spawning failed
   * @private
   */
  private async spawn(
    id: string,
    spawnable: Spawnable,
    options: SpawnOptions,
    cid = getCorrelationIdentifier(),
  ): Promise<ActivityRef | null> {
    const logPayload = { cid, in: 'spawn', actionId: id };

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace(logPayload, ...args);

    const error = (...args: Array<string | Record<string, unknown>>) =>
      this.error(logPayload, ...args);

    trace({ message: 'Spawning a spawnable' });

    if (isPromiseLike(spawnable)) {
      trace({ message: 'Spawning a promise' });
      return await this.spawnPromise(
        id,
        Promise.resolve(spawnable),
        options,
        cid,
      );
    }

    // Callback
    else if (isFunction(spawnable)) {
      trace({ message: 'Spawning a callback' });
      return await this.spawnCallback(
        id,
        spawnable as InvokeCallback,
        options,
        cid,
      );
    }

    // TODO figure out what this means
    //  else if (isSpawnedActor(entity)) {
    //   return this.spawnActor(entity, name);
    //  }

    // Observables
    else if (isObservable<TEvent>(spawnable)) {
      trace({ message: 'Spawning an observable' });
      return await this.spawnObservable(id, spawnable, options, cid);
    }

    // Is an unregistered throwaway machine
    else if (isMachine(spawnable)) {
      return await this.spawnUnregisteredMachine(id, spawnable, options);
    }

    // TODO figure out what this means
    //  else if (isBehavior(entity)) {
    //   return this.spawnBehavior(entity, name);
    //  }
    else {
      error({
        message: 'Unknown spawnable type',
        spawnableType: typeof spawnable,
      });
      throw new Error(
        `Unable to spawn entity "${id}" of type "${typeof spawnable}".`,
      );
    }
  }

  private async spawnPromise<ResolveType>(
    id: string,
    promise: Promise<ResolveType>,
    options: SpawnOptions,
    cid = getCorrelationIdentifier(),
  ): Promise<ActivityRef> {
    const autoForward = options.autoForward ?? false;

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'spawnPromise', id }, ...args);

    let completed = false;
    let cancelled = false;

    // For unsubscribing
    const observers = new Set<Observer<EventObject>>();

    return {
      id,
      owner: this.ref,
      autoForward,
      toJSON: () => ({ id }),
      send: () => {
        // Promises cannot receive events, so swallow silently
      },
      stop: (): void => {
        cancelled = true;
      },
      subscribe: (
        onNext: Observer<EventObject> | ((value: EventObject) => void),
        onError?: (error: any) => void,
        onComplete?: () => void,
      ): Subscription => {
        const observer = toObserver(onNext, onError, onComplete);
        observers.add(observer);

        if (completed) {
          if (!cancelled) {
            observer.complete();
          }
        } else {
          promise
            .then((value: ResolveType) => {
              if (cancelled) {
                return;
              }

              observer.next(doneInvoke(id, value));

              completed = true;
              observer.complete();
            })
            .catch((error) => {
              if (cancelled) {
                return;
              }

              observer.error(error);
            });
        }

        return {
          unsubscribe() {
            observers.delete(observer);
          },
        };
      },
    };
  }

  /**
   * @returns `null`, if spawning failed
   * @private
   */
  private async spawnCallback(
    id: string,
    callback: InvokeCallback<AnyEventObject>,
    options: SpawnOptions,
    cid = getCorrelationIdentifier(),
  ): Promise<ActivityRef | null> {
    const autoForward = options.autoForward ?? false;

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'spawnCallback', id }, ...args);

    let canceled = false;

    // Event listeners registered by the calling site
    // const receivers = new Set<(event: AnyEventObject) => void>();

    // For unsubscribing
    const observers = new Set<Observer<Event<AnyEventObject>>>();

    trace({ message: 'Spawning a callback' });

    // const receive: Sender<AnyEventObject> = (event: Event<AnyEventObject>) => {
    //   if (canceled) {
    //     return;
    //   }
    //
    //   for (const receiver of receivers) {
    //     receiver(toEventObject(event));
    //   }
    //
    //   // this.send(
    //   //   toSCXMLEvent(event as Event<TEvent> | SCXML.Event<TEvent>, {
    //   //     origin: id,
    //   //   }),
    //   //   undefined,
    //   //   false,
    //   //   id,
    //   //   cid,
    //   // );
    // };

    let initialError: any = null;
    let receiver: ((event: AnyEventObject) => void) | null = null;
    let listener: ((event: AnyEventObject) => void) | null = null;
    let callbackStop: (() => void) | null = null;

    try {
      // The invoked callback can return a function that
      // must be called when stopping this activity
      callbackStop = callback(
        // Passing a function that the callback can use to
        // send events to this chart (`send`)
        (event) => receiver?.(toEventObject(event)),
        // Pass a function that registers an event listener
        // to this chart's events (`onReceive`)
        (onReceiveListener) => {
          listener = onReceiveListener;
        },
      ) as () => void | undefined;
    } catch (error) {
      initialError = error;
    }

    if (isPromiseLike(callbackStop)) {
      // it turned out to be an async function, can't reliably check this before calling
      // `callback` because transpiled async functions are not recognizable. In this case
      // this was misrecognized as callback instead of a promise-like activity.
      trace({
        message: 'Callback turned out to be a promise-like activity',
      });
      return this.spawnPromise(
        id,
        callbackStop as unknown as Promise<any>,
        options,
        cid,
      );
    }

    return {
      id,
      owner: this.ref,
      autoForward,
      toJSON: () => ({ id }),

      // Send event to this activity
      send: (event) => {
        try {
          listener?.(toEventObject(event));
        } catch (error) {
          trace({
            type: 'warning',
            message:
              'Callback failed to receive an event. ' +
              'This indicates an error with the callback activity.',
            error,
          });
        }
      },

      // Receive updates and events from this activity
      subscribe: (
        onNext:
          | Observer<Event<EventObject> | SCXML.Event<EventObject>>
          | ((value: Event<EventObject> | SCXML.Event<EventObject>) => void),
        onError?: (error: any) => void,
        onComplete?: () => void,
      ): Subscription => {
        const observer = toObserver(onNext, onError, onComplete);
        observers.add(observer);

        if (initialError) {
          observer.error(initialError);
        }

        receiver = (event) => {
          observer.next(event);
        };

        return {
          unsubscribe: () => {
            this.stop();
            observers.delete(observer);
            receiver = null;
          },
        };
      },

      // Stop the activity
      stop: () => {
        canceled = true;
        if (isFunction(callbackStop)) {
          callbackStop();
        }
      },
    };
  }

  private async spawnObservable(
    id: string,
    source: Subscribable<Event<TEvent>>,
    options: SpawnOptions,
    cid = getCorrelationIdentifier(),
  ): Promise<ActivityRef> {
    const autoForward = options.autoForward ?? false;

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'spawnObservable', id }, ...args);

    trace({ message: 'Spawning an observable' });

    // For unsubscribing
    const observers = new Set<Observer<Event<TEvent>>>();

    let subscription: Subscription | null = null;

    return {
      id,
      owner: this.ref,
      autoForward,
      toJSON: () => ({ id }),
      send: () => {
        // Observables cannot receive events, so swallow silently
      },
      subscribe: (
        onNext: ((value: Event<TEvent>) => void) | Observer<Event<TEvent>>,
        onError?: (error: any) => void,
        onComplete?: () => void,
      ) => {
        const observer = toObserver(onNext, onError, onComplete);
        observers.add(observer);

        subscription = source.subscribe({
          next: observer.next,
          complete: () => {
            // Observable cannot complete with a value
            observer.next(doneInvoke(id));
            observer.complete();
          },
          error: observer.error,
        });

        return {
          unsubscribe: () => observers.delete(observer),
        };
      },
      stop: () => {
        subscription?.unsubscribe();
      },
    };
  }

  private async spawnUnregisteredMachine<
    TChildContext,
    TChildStateSchema extends StateSchema<any>,
    TChildEvent extends EventObject,
  >(
    id: string,
    machine: StateMachine<TChildContext, TChildStateSchema, TChildEvent>,
    options: SpawnOptions,
  ): Promise<ActivityRef> {
    let childService: Interpreter<
      TChildContext,
      TChildStateSchema,
      TChildEvent
    > | null = null;

    // const observers = new Set<Observer<EventObject>>();

    const resolvedOptions = {
      sync: false,
      autoForward: false,
      ...options,
    };

    return {
      id,
      toJSON: () => ({ id }),
      owner: this.ref,
      autoForward: resolvedOptions.autoForward,
      send: (event: Event<EventObject> | SCXML.Event<EventObject>) => {
        childService?.send(
          toSCXMLEvent(event as TChildEvent, { origin: childService.id }),
        );
      },
      subscribe: (
        onNext:
          | Observer<Event<EventObject>>
          | ((value: Event<EventObject> | SCXML.Event<EventObject>) => void),
        onError?: (error: any) => void,
        onComplete?: () => void,
      ): Subscription => {
        const observer = toObserver(onNext, onError, onComplete);

        childService = new Interpreter(machine, {
          id: id || machine.id,
        });

        if (resolvedOptions.sync) {
          childService.onTransition(
            (state: State<TChildContext, TChildEvent, TChildStateSchema>) => {
              observer.next(
                toSCXMLEvent({
                  type: ActionTypes.Update,
                  state,
                  id: childService?.id,
                }),
              );
            },
          );
        }

        childService.onDone((doneEvent) => {
          observer.next(
            toSCXMLEvent(doneEvent as any, { origin: childService?.id }),
          );
          observer.complete();

          // observer.next(
          //   toSCXMLEvent(doneEvent as any, { origin: childService?.id }),
          // );
          // this.xJog.sendEvent(
          //   this.ref,
          //   toSCXMLEvent(doneEvent as any, { origin: childService.id }),
          //   undefined,
          //   id,
          // );
        });

        // Stream any events to the actor
        childService.onEvent((event: EventObject) => {
          observer.next(event);

          // for (const observer of observers) {
          //   observer.next(event);
          // }
        });

        childService.start();

        // const observer = toObserver(onNext, onError, onComplete);
        // observers.add(observer);

        return {
          unsubscribe: () => {
            this.stop();
            // observers.delete(observer);
          },
        };
      },
      stop: () => {
        childService?.stop();
      },
    };
  }

  private async defer(
    action: XJogSendAction<TContext, TEvent>,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    return this.xJog.timeExecution('chart.defer', async () => {
      const trace = (...args: Array<string | Record<string, unknown>>) =>
        this.trace({ cid, in: 'defer', actionId: action.id }, ...args);

      const delay = action.delay ?? 0;

      const PersistedDeferredEvent: Omit<
        PersistedDeferredEvent,
        'id' | 'timestamp' | 'due'
      > & {
        eventId?: string | number;
      } = {
        ref: this.ref,
        event: action._event,
        // TODO what should we pass as eventId?
        eventId: action.id,
        // TODO should we also pass actionId and sendId?
        eventTo: action.to ?? null,
        delay,
        lock: null,
      };

      trace({ message: 'Deferring event sending action' });
      await this.xJog.deferredEventManager.defer(PersistedDeferredEvent, cid);

      trace({ message: 'Done' });
    });
  }

  public async stop(cid = getCorrelationIdentifier()) {
    return this.xJog.timeExecution('chart.stop', async () => {
      const trace = (...args: Array<string | Record<string, unknown>>) =>
        this.trace({ cid, in: 'kill' }, ...args);

      trace({ message: 'Entering stopping state' });
      this.stopping = true;

      await this.xJog.deferredEventManager.cancelAllForChart(this.ref);
      await this.xJog.activityManager.stopAllForChart(this.ref);
    });
  }

  public async registerExternalId(
    key: string,
    value: string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    await this.xJogMachine.registerExternalId(this.id, key, value, cid);
  }

  public async dropExternalId(
    key: string,
    value: string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    await this.xJogMachine.dropExternalId(key, value, cid);
  }

  public get updates(): Observable<
    State<TContext, TEvent, TStateSchema, TTypeState>
  > {
    return concat(
      of(this.state),
      from(
        this.xJog.changeSubject.pipe(
          filter(
            (change) =>
              change.ref.machineId === this.ref.machineId &&
              change.ref.chartId === this.ref.chartId &&
              !!change.new,
          ),
          map((change) => {
            if (!change.new) {
              throw new Error('Unexpected condition');
            }
            return State.from<TContext, TEvent>(
              change.new.value,
              change.new.context,
            );
          }),
        ),
      ),
    );
  }

  public async waitForState(
    expectedStateValue: TTypeState['value'] | TTypeState['value'][],
    timeoutMilliseconds = 0,
    cid = getCorrelationIdentifier(),
  ): Promise<State<TContext, TEvent, TStateSchema, TTypeState>> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'waitForState' }, ...args);

    trace({ message: 'Waiting for state', expectedStateValue });

    const stateMatches = (
      candidate: State<TContext, TEvent, TStateSchema, TTypeState>,
    ) =>
      Array.isArray(expectedStateValue)
        ? expectedStateValue.find((value) => candidate.matches(value))
        : candidate.matches(expectedStateValue);

    return new Promise((resolve, reject) => {
      if (stateMatches(this.state)) {
        trace({ message: 'State matches' });
        return resolve(this.state);
      }

      trace({ message: 'Waiting for the next state' });
      this.waitForNextState(expectedStateValue, timeoutMilliseconds, cid)
        .then(resolve)
        .catch(reject);
    });
  }

  public async waitForNextState(
    expectedStateValue: TTypeState['value'] | TTypeState['value'][],
    timeoutMilliseconds = 0,
    cid = getCorrelationIdentifier(),
  ): Promise<State<TContext, TEvent, TStateSchema, TTypeState>> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'waitForState' }, ...args);

    const stateMatches = (
      candidate: State<TContext, TEvent, TStateSchema, TTypeState>,
    ) =>
      Array.isArray(expectedStateValue)
        ? expectedStateValue.find((value) => candidate.matches(value))
        : candidate.matches(expectedStateValue);

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;

      trace({ message: 'Subscribing to the chart' });
      const subscription = this.updates.subscribe({
        next: (state: State<TContext, TEvent, TStateSchema, TTypeState>) => {
          if (stateMatches(state)) {
            trace({ message: 'Updated state is a match, unsubscribing' });
            subscription.unsubscribe();

            if (timeoutHandle) {
              trace({ message: 'Clearing the timeout handle' });
              clearTimeout(timeoutHandle);
            }

            trace({ message: 'Resolving' });
            resolve(state);
          }
        },
        error: (error) => {
          if (timeoutHandle) {
            trace({ message: 'Clearing the timeout handle' });
            clearTimeout(timeoutHandle);
          }

          trace({ level: 'warning', message: 'Rejecting', error });
          reject(error);
        },
        complete: () => reject(new Error('Should not complete')),
      });

      if (timeoutMilliseconds > 0) {
        trace({ message: 'Installing a timeout', timeoutMilliseconds });

        timeoutHandle = setTimeout(() => {
          trace({ message: 'Timeout, unsubscribing' });
          subscription.unsubscribe();

          trace({ message: 'Rejecting' });
          reject(
            new Error(
              `Waiting for next state ${JSON.stringify(
                expectedStateValue,
              )} timed out after ${timeoutMilliseconds} ms`,
            ),
          );
        }, timeoutMilliseconds);
      }
    });
  }

  public async waitForFinalState(
    timeoutMilliseconds = 0,
    cid = getCorrelationIdentifier(),
  ): Promise<any> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'waitForFinalState' }, ...args);

    if (this.state.done) {
      trace({ message: 'Already done' });
      const doneData = this.resolveDoneData(this.state, cid);
      return Promise.resolve(doneData);
    }

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;

      const identifier = this.ref;
      const xJog = this.xJog;

      const subscription = this.updates.subscribe(
        (state: State<TContext, TEvent, TStateSchema, TTypeState>) => {
          if (state.done) {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }
            const doneData = this.resolveDoneData(this.state, cid);
            resolve(doneData);
            subscription.unsubscribe();
          }
        },
      );

      if (timeoutMilliseconds > 0) {
        trace({ message: 'Installing a timeout', timeoutMilliseconds });

        timeoutHandle = setTimeout(() => {
          trace({ message: 'Timeout, rejecting' });
          reject(
            new Error(
              `Waiting for final state timed out after ${timeoutMilliseconds} ms`,
            ),
          );
        }, timeoutMilliseconds);
      }
    });
  }

  /** Pend until XJogChart mutex is released */
  public async wait(cid = getCorrelationIdentifier()): Promise<void> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace({ cid, in: 'wait' }, ...args);

    const error = (...args: Array<string | Record<string, unknown>>) =>
      this.error({ cid, in: 'wait' }, ...args);

    try {
      trace({ message: 'Waiting for mutex release' });

      await this.chartMutex.waitForUnlock();
    } catch (err) {
      error({ message: 'Mutex failure' });
      throw new Error(
        `Waiting for mutex unlock timed out in chart ` +
          `${this.xJogMachine.id}/${this.id} ` +
          `in wait method`,
      );
    }

    trace({ message: 'Mutex released' });
  }

  public log(...payloads: Array<string | Partial<LogFields>>) {
    return this.xJogMachine.log(
      {
        component: this.component,
        chartId: this.id,
      },
      ...payloads,
    );
  }
}
