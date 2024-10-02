import { v4 as uuidV4 } from 'uuid';
import { EventObject, StateSchema, Typestate, State } from 'xstate';

import {
  AbstractPersistenceAdapter,
  ChartReference,
  getCorrelationIdentifier,
} from '@samihult/xjog-util';

import { PersistedChart, PersistedDeferredEvent } from './EntryTypes';

/**
 * Abstract adapter class for XJog persistence.
 * @hideconstructor
 */
export abstract class PersistenceAdapter<
  ConnectionType = unknown,
> extends AbstractPersistenceAdapter {
  ////////////////////////////////////////////////////////////////////////////////
  // Abstract low-level methods that need to be implemented by a concrete subclass

  /**
   * Executes the routine within a transaction. In case of an error,
   * rolls back. Otherwise, commits at the end. Inside, use the client,
   * if applicable.
   * @abstract
   */
  public abstract withTransaction<ReturnType>(
    routine: (client: ConnectionType) => Promise<ReturnType> | ReturnType,
  ): Promise<ReturnType>;

  /**
   * @abstract
   */
  public abstract countAliveInstances(
    connection?: ConnectionType,
  ): Promise<number>;

  /**
   * @abstract
   */
  protected abstract insertInstance(
    id: string,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   */
  protected abstract deleteInstance(
    id: string,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   */
  protected abstract markAllInstancesDying(
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * Function that notifies the callback when
   * this instance is marked as dying
   *
   * @abstract
   * @returns A function to stop listening
   */
  public abstract onDeathNote(
    instanceId: string,
    callback: () => void,
  ): () => void;

  /**
   * @abstract
   */
  protected abstract insertChart<
    TContext,
    TEvent extends EventObject,
    TStateSchema extends State<any>,
    TTypeState extends Typestate<any>,
  >(
    instanceId: string,
    ref: ChartReference,
    parentRef: ChartReference | null,
    state: State<TContext, TEvent, TStateSchema, TTypeState>,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   */
  protected abstract readChart<TContext, TEvent extends EventObject>(
    ref: ChartReference,
    connection?: ConnectionType,
  ): Promise<PersistedChart<TContext, TEvent>>;

  /**
   * @abstract
   */
  protected abstract updateChartState<TContext, TEvent extends EventObject>(
    ref: ChartReference,
    serializedState: State<
      TContext,
      TEvent,
      StateSchema<TContext>,
      Typestate<TContext>
    >,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   */
  protected abstract markAllChartsPaused(
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   */
  protected abstract countPausedCharts(
    connection?: ConnectionType,
  ): Promise<number>;

  /**
   * @abstract
   * @group Charts
   */
  protected abstract getPausedChartIds(
    connection?: ConnectionType,
  ): Promise<ChartReference[]>;

  /**
   * @abstract
   */
  protected abstract getPausedChartWithNoOngoingActivitiesIds(
    connection?: ConnectionType,
  ): Promise<ChartReference[]>;

  /**
   */
  public abstract countOwnCharts(
    instanceId: string,
    connection?: ConnectionType,
  ): Promise<number>;

  /**
   * @abstract
   * @returns Number of deleted rows
   */
  protected abstract deleteOngoingActivitiesForPausedCharts(
    connection?: ConnectionType,
  ): Promise<number>;

  /**
   * @abstract
   */
  protected abstract changeOwnerAndResumePausedCharts(
    id: string,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   */
  protected abstract changeOwnerAndResumeCharts(
    instanceId: string,
    refs: ChartReference[],
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   * @returns Number of deleted records
   */
  protected abstract deleteChart(
    ref: ChartReference,
    connection?: ConnectionType,
  ): Promise<number>;

  /**
   * @abstract
   * @returns Check if an activity is registered as ongoing
   */
  public abstract isActivityRegistered(
    ref: ChartReference,
    activityId: string,
    connection?: ConnectionType,
  ): Promise<boolean>;

  /**
   * @abstract
   * @returns Register a new ongoing activity
   */
  public abstract registerActivity(
    ref: ChartReference,
    activityId: string,
    cid: string,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   * @returns Unregister a new ongoing activity
   */
  public abstract unregisterActivity(
    ref: ChartReference,
    activityId: string,
    cid: string,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   * @returns Inserted id
   */
  protected abstract insertDeferredEvent(
    deferredEventRow: Omit<PersistedDeferredEvent, 'id' | 'due' | 'timestamp'>,
    connection?: ConnectionType,
  ): Promise<PersistedDeferredEvent | null>;

  /**
   * Read single deferred event
   *
   * @abstract
   * @param id
   * @param connection
   */
  protected abstract readDeferredEventRow(
    id: number,
    connection?: ConnectionType,
  ): Promise<PersistedDeferredEvent | null>;

  /**
   * In ascending order by due time.
   *
   * @abstract
   */
  protected abstract readDeferredEventRowBatch(
    instanceId: string,
    lookAhead: number,
    batchSize: number,
    connection?: ConnectionType,
  ): Promise<PersistedDeferredEvent[]>;

  /**
   * @abstract
   * @group Deferred events
   */
  // protected abstract markDeferredEventBatchForProcessing(
  //   instanceId: string,
  //   lookAhead: number,
  //   batchSize: number,
  //   connection?: ConnectionType,
  // ): Promise<void>;

  /**
   * @abstract
   */
  public abstract releaseDeferredEvent(
    ref: ChartReference,
    eventId: number,
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   */
  protected abstract unmarkAllDeferredEventsForProcessing(
    connection?: ConnectionType,
  ): Promise<void>;

  /**
   * @abstract
   * @returns Number of deleted records
   */
  protected abstract deleteDeferredEvent(
    id: number,
    connection?: ConnectionType,
  ): Promise<number>;

  /**
   * @abstract
   * @returns Number of deleted records
   */
  protected abstract deleteAllDeferredEvents(
    ref: ChartReference,
    connection?: ConnectionType,
  ): Promise<number>;

  /**
   * @abstract
   */
  public abstract getExternalIdentifiers(
    key: string,
    ref: ChartReference,
    connection?: ConnectionType,
  ): Promise<string[]>;

  public abstract registerExternalId(
    ref: ChartReference,
    key: string,
    value: string,
    cid: string,
  ): Promise<void>;

  public abstract dropExternalId(
    key: string,
    value: string,
    cid: string,
  ): Promise<number>;

  // TODO rename!
  /**
   * @abstract
   * @group External identifiers
   */
  public abstract getChartByExternalIdentifier(
    key: string,
    value: string,
    connection?: ConnectionType,
  ): Promise<ChartReference | null>;

  /**
   * @abstract
   * @returns Number of deleted records
   */
  protected abstract deleteExternalIdentifiers(
    ref: ChartReference,
    connection?: ConnectionType,
  ): Promise<number>;

  /////////////////////////////////////////////////////////////////////////////
  // Higher-level methods that can to be overridden by a subclass, if necessary

  public async overthrowOtherInstances(
    instanceId: string,
    cid: string,
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'overthrowOtherInstances', ...args });

    await this.withTransaction(async (connection) => {
      trace({ message: 'Marking all instances dying' });
      await this.markAllInstancesDying(connection);

      trace({ message: 'Marking all charts paused' });
      await this.markAllChartsPaused(connection);

      trace({ message: 'Adding the instance to the list' });
      await this.insertInstance(instanceId, connection);
    });

    trace({ message: 'Done' });
  }

  public async removeInstance(instanceId: string, cid: string): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'removeInstance', ...args });

    await this.deleteInstance(instanceId);

    trace({ message: 'Done' });
  }

  public async getPausedChartCount(cid: string): Promise<number> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'getPausedChartCount', ...args });

    trace({ message: 'Counting paused charts' });
    const pausedChartCount = await this.countPausedCharts();
    trace({ message: 'Counted paused charts', pausedChartCount });

    return pausedChartCount;
  }

  /**
   * @param instanceId
   * @param cid
   * @returns Chart id list for the adopted charts
   */
  public async gentlyAdoptCharts(
    instanceId: string,
    cid: string,
  ): Promise<ChartReference[]> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'gentlyAdoptCharts', id: instanceId, ...args });

    trace({ message: 'Gently adopt all idle charts' });

    const adoptedChartIds =
      await this.getPausedChartWithNoOngoingActivitiesIds();
    await this.changeOwnerAndResumeCharts(instanceId, adoptedChartIds);

    trace({ message: 'Done' });
    return adoptedChartIds;
  }

  /**
   * @param instanceId
   * @param cid
   */
  public async forciblyAdoptCharts(
    instanceId: string,
    cid: string,
  ): Promise<ChartReference[]> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'forciblyAdoptCharts', ...args });

    trace({ message: 'Forcibly adopt all foreign charts' });

    return this.withTransaction(async (connection) => {
      const adoptedChartIds = await this.getPausedChartIds(connection);
      await this.deleteOngoingActivitiesForPausedCharts(connection);
      await this.changeOwnerAndResumePausedCharts(instanceId, connection);

      trace({ message: 'Done' });
      return adoptedChartIds;
    });
  }

  /**
   * @param instanceId
   * @param ref
   * @param state
   * @param parentRef
   * @param cid
   */
  public async createChart<
    TContext,
    TEvent extends EventObject,
    TStateSchema extends StateSchema<any>,
    TTypeState extends Typestate<any>,
  >(
    instanceId: string,
    ref: ChartReference,
    state: State<TContext, TEvent, TStateSchema, TTypeState>,
    parentRef: ChartReference | null = null,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'createChart', ...args });

    trace({ message: 'Writing state to the database' });
    await this.insertChart(instanceId, ref, parentRef, state);

    trace({ message: 'Done' });
  }

  /**
   * @param ref
   * @param cid
   * @param connection
   */
  public async loadChart<
    TContext,
    TEvent extends EventObject,
    TStateSchema extends StateSchema,
    TTypeState extends Typestate<TContext>,
  >(
    ref: ChartReference,
    cid = getCorrelationIdentifier(),
    connection?: ConnectionType,
  ): Promise<{
    state: State<TContext, TEvent, TStateSchema, TTypeState>;
    ref: ChartReference;
    parentRef: ChartReference | null;
  } | null> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'loadChart', ref, ...args });

    trace({ message: 'Reading chart from the database' });
    const chartRow = await this.readChart<TContext, TEvent>(ref, connection);

    trace({ message: 'Creating state object' });
    const state = State.create<TContext, TEvent>(chartRow.state);

    trace({ message: 'Done' });

    return {
      ref: chartRow.ref,
      parentRef: chartRow.parentRef,
      state: state as unknown as State<
        TContext,
        TEvent,
        TStateSchema,
        TTypeState
      >,
    };
  }

  /**
   * @param ref
   * @param state
   * @param cid
   * @param connection
   */
  public async updateChart<TContext, TEvent extends EventObject>(
    ref: ChartReference,
    state: State<TContext, TEvent, any, any>,
    cid = getCorrelationIdentifier(),
    connection?: ConnectionType,
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'updateChart', ref, ...args });

    trace({ message: 'Storing the chart to the database' });
    await this.updateChartState(ref, state, connection);

    trace({ message: 'Done' });
  }

  /**
   * @param ref
   * @param cid
   */
  public async destroyChart(
    ref: ChartReference,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'destroyChart', ref, ...args });

    await this.withTransaction(async (connection) => {
      trace({ message: 'Removing chart from the database' });
      const deletedChartRecords = await this.deleteChart(ref, connection);

      if (deletedChartRecords < 1) {
        trace({ level: 'warning', message: 'Chart not found in the database' });
        return;
      } else if (deletedChartRecords === 1) {
        trace({ message: 'Removed chart from the database' });
      } else {
        trace({
          level: 'warning',
          message: 'Removed multiple charts from the database',
          deletedRecords: deletedChartRecords,
        });
      }

      trace({ message: 'Removing deferred events from the database' });
      const deletedDeferredEventRecords = await this.deleteAllDeferredEvents(
        ref,
        connection,
      );
      trace({
        message: 'Removed deferred events from the database',
        deletedRecords: deletedDeferredEventRecords,
      });

      trace({ message: 'Removing external identifiers from the database' });
      const deletedExternalIdentifierRecords =
        await this.deleteExternalIdentifiers(ref, connection);
      trace({
        message: 'Removed external identifiers from the database',
        deletedRecords: deletedExternalIdentifierRecords,
      });
    });

    trace({ message: 'Done' });
  }

  /**
   * @param deferredEventRow
   * @param cid
   */
  public async deferEvent<TContext, TEvent extends EventObject>(
    deferredEventRow: Omit<
      PersistedDeferredEvent,
      'id' | 'eventId' | 'due' | 'timestamp'
    > & { eventId?: number | string },
    cid = getCorrelationIdentifier(),
  ): Promise<PersistedDeferredEvent> {
    const trace = (args: Record<string, any>) =>
      this.trace({
        cid,
        in: 'deferEvent',
        ref: deferredEventRow.ref,
        eventId: deferredEventRow.eventId,
        lock: deferredEventRow.lock,
        ...args,
      });

    return await this.withTransaction(async (connection) => {
      trace({
        message: 'Inserting deferred event into the database',
        delay: deferredEventRow.delay,
      });

      const insertedEventRow = await this.insertDeferredEvent({
        ref: deferredEventRow.ref,

        eventId: deferredEventRow.eventId ?? uuidV4(),
        eventTo: deferredEventRow.eventTo ?? null,
        event: deferredEventRow.event,

        delay: deferredEventRow.delay,

        lock: deferredEventRow.lock,
      });

      if (!insertedEventRow) {
        throw new Error(
          `Failed to insert deferred event ${deferredEventRow.eventId}`,
        );
      }

      trace({ message: 'Done' });
      return insertedEventRow;
    });
  }

  /**
   * @param cid
   */
  public async releaseAllDeferredEvents(
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'releaseAllDeferredEvents', ...args });

    trace({ message: 'Releasing deferred events' });
    await this.unmarkAllDeferredEventsForProcessing();

    trace({ message: 'Done' });
  }

  /**
   * @param instanceId
   * @param lookAhead
   * @param batchSize
   * @param cid
   */
  public async takeUpcomingDeferredEvents(
    instanceId: string,
    lookAhead: number,
    batchSize: number,
    cid = getCorrelationIdentifier(),
  ): Promise<PersistedDeferredEvent[]> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'takeUpcomingDeferredEvents', ...args });

    trace({
      message: 'Reading upcoming events from the database',
      batchSize,
      lookAhead,
    });

    trace({ message: 'Taking upcoming events' });
    const deferredEvents = await this.readDeferredEventRowBatch(
      instanceId,
      lookAhead,
      batchSize,
    );

    trace({ message: 'Done', count: deferredEvents.length });
    return deferredEvents;
  }

  /**
   * @param deferredEventRow
   * @param cid
   */
  public async removeDeferredEvent(
    deferredEventRow: PersistedDeferredEvent,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({
        cid,
        in: 'removeDeferredEvent',
        ref: deferredEventRow.ref,
        id: deferredEventRow.id,
        ...args,
      });

    trace({ message: 'Removing deferred event from the database' });
    await this.deleteDeferredEvent(deferredEventRow.id);

    trace({ message: 'Done' });
  }
}
