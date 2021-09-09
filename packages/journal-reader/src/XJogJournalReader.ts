import { XJogLogEmitter, nullSafeApplyJsonDiff } from '@samihult/xjog-util';
import { Observable, from, concat, concatMap } from 'rxjs';
import { EventObject } from 'xstate';

import {
  JournalPersistenceAdapter,
  FullStateQuery,
  JournalQuery,
  JournalEntry,
  FullStateEntry,
} from '@samihult/xjog-journal-persistence';

import { MergedJournalEntry } from './MergedJournalEntry';

export class XJogJournalReader extends XJogLogEmitter {
  public readonly component = 'journal/reader';

  constructor(private readonly persistence: JournalPersistenceAdapter) {
    super();
  }

  public observeFullStates(query: FullStateQuery): Observable<FullStateEntry> {
    return concat(
      from(this.persistence.queryFullStates(query)).pipe(
        // From array to individual items
        concatMap((entry: FullStateEntry[]) => entry),
      ),
      this.persistence.newFullStateEntries(query),
    );
  }

  public observeJournal(query: JournalQuery): Observable<JournalEntry> {
    return concat(
      from(this.persistence.queryEntries(query)).pipe(
        // From array to individual items
        concatMap((entry: JournalEntry[]) => entry),
      ),
      this.persistence.newJournalEntries(query),
    );
  }

  public async readMergedJournalEntry<
    TContext,
    TEvent extends EventObject = EventObject,
  >(id: number): Promise<MergedJournalEntry | null> {
    const journalEntry = await this.persistence.readEntry(id);

    if (!journalEntry) {
      return null;
    }

    const fullState = await this.persistence.readFullState(journalEntry.ref);

    if (!fullState) {
      return null;
    }

    const journalEntries = await this.persistence.queryEntries({
      ref: journalEntry.ref,
      afterAndIncludingId: id,
      order: 'DESC',
    });

    const mergedJournalEntry: MergedJournalEntry = {
      ...fullState,
      stateDelta: [],
      contextDelta: [],
      previousState: null,
      previousContext: null,
    };

    for (const journalEntry of journalEntries) {
      mergedJournalEntry.event = journalEntry.event;

      if (mergedJournalEntry.previousState) {
        mergedJournalEntry.state = mergedJournalEntry.previousState;
      }

      if (mergedJournalEntry.previousContext) {
        mergedJournalEntry.context = mergedJournalEntry.previousContext;
      }

      mergedJournalEntry.previousState = nullSafeApplyJsonDiff(
        mergedJournalEntry.state,
        journalEntry.stateDelta,
      );

      mergedJournalEntry.previousContext = nullSafeApplyJsonDiff(
        mergedJournalEntry.context,
        journalEntry.contextDelta,
      );
    }

    return mergedJournalEntry;
  }
}
