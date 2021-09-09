import { Operation } from 'rfc6902';
import { FullStateEntry } from '@samihult/xjog-journal-persistence';
import { EventObject, StateValue } from 'xstate';

export type MergedJournalEntry = FullStateEntry & {
  stateDelta: Operation[];
  contextDelta: Operation[];
  previousState: StateValue | null;
  previousContext: any | null;
};
