import { StateValue, BaseActionObject } from 'xstate';
import { createPatch } from 'rfc6902';
import { from, Observable, Subject, filter } from 'rxjs';
import { EventObject, StateSchema, Typestate } from 'xstate/lib/types';

import {
  getCorrelationIdentifier,
  AbstractPersistenceAdapter,
  ChartReference,
  XJogStateChangeAction,
} from '@samihult/xjog-util';

import { fullStateFilterByQuery } from './fullStateFilterByQuery';
import { journalFilterByQuery } from './journalFilterByQuery';
import { FullStateQuery } from './FullStateQuery';
import { FullStateEntry } from './FullStateEntry';
import { JournalQuery } from './JournalQuery';

import {
  JournalEntry,
  JournalEntryAutoFields,
  JournalEntryInsertFields,
} from './JournalEntry';

/**
 * Abstract adapter class for XJog journal persistence.
 * @hideconstructor
 */
export abstract class JournalPersistenceAdapter extends AbstractPersistenceAdapter {
  protected readonly newJournalEntriesSubject = new Subject<JournalEntry>();
  protected readonly newFullStateEntriesSubject = new Subject<FullStateEntry>();

  protected constructor() {
    super();
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Abstract low-level methods that need to be implemented by a concrete subclass

  /**
   * Important! The `id` must be monotonically increasing!
   * @param entry
   * @protected
   */
  protected abstract insertEntry(
    entry: JournalEntryInsertFields,
  ): Promise<JournalEntryAutoFields>;

  /**
   * Important! Only update if the incoming data is newer than already recorded!
   * @param entry
   * @protected
   */
  protected abstract updateFullState(
    entry: Omit<FullStateEntry, 'created'>,
  ): Promise<void>;

  protected abstract emitJournalEntryNotification(
    id: number,
    ref: ChartReference,
  ): Promise<void>;

  public abstract readEntry(id: number): Promise<JournalEntry | null>;
  public abstract queryEntries(query: JournalQuery): Promise<JournalEntry[]>;

  public abstract readFullState(
    ref: ChartReference,
  ): Promise<FullStateEntry | null>;

  public abstract queryFullStates(
    query: FullStateQuery,
  ): Promise<FullStateEntry[]>;

  public abstract getCurrentTime(): Promise<number>;

  /**
   * Delete full states and journal entries.
   * @param ref
   */
  public abstract deleteByChart(ref: ChartReference): Promise<number>;

  /////////////////////////////////////////////////////////////////////////////
  // Higher-level methods that can to be overridden by a subclass, if necessary

  public newFullStateEntries(
    query?: FullStateQuery,
  ): Observable<FullStateEntry> {
    return from(this.newFullStateEntriesSubject).pipe(
      filter(fullStateFilterByQuery(query)),
    );
  }

  public newJournalEntries(query?: JournalQuery): Observable<JournalEntry> {
    return from(this.newJournalEntriesSubject).pipe(
      filter(journalFilterByQuery(query)),
    );
  }

  /**
   * @group Deltas
   * @param ownerId
   * @param ref
   * @param parentRef
   * @param event
   * @param oldState
   * @param oldContext
   * @param newState
   * @param newContext
   * @param actions
   * @param cid
   */
  public async record<
    TContext = any,
    TEvent extends EventObject = EventObject,
    TStateSchema extends StateSchema = any,
    TTypeState extends Typestate<TContext> = {
      value: any;
      context: TContext;
    },
  >(
    ownerId: string,
    ref: ChartReference,
    parentRef: ChartReference | null,
    event: TEvent | null,
    oldState: StateValue | null,
    oldContext: TContext | null,
    newState: StateValue | null,
    newContext: TContext | null,
    actions: XJogStateChangeAction[] | null,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const logPayload = { in: 'record', ref, cid };

    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.trace(logPayload, ...args);

    const error = (...args: Array<string | Record<string, unknown>>) =>
      this.error(logPayload, ...args);

    trace('Storing the new journal entry');

    try {
      // Diff to travel *back* in time
      const stateDelta = createPatch(newState, oldState);
      const contextDelta = createPatch(newContext, oldContext);

      trace('Storing the journal entry into the database');
      const { id, timestamp } = await this.insertEntry({
        ref,
        event,
        stateDelta,
        contextDelta,
        actions,
      });

      trace('Updating the full state into the database');
      await this.updateFullState({
        id,
        timestamp,
        ownerId,
        ref,
        parentRef,
        event,
        state: newState,
        context: newContext,
        actions,
      });

      trace('Emitting a notification that there is a new journal entry');
      await this.emitJournalEntryNotification(id, ref);
    } catch (err) {
      error('Failed to record journal entries', { err });
      throw error;
    } finally {
      trace({ message: 'Done' });
    }
  }
}
