import { EventObject, StateValue } from 'xstate';
import { ChartReference } from '@samihult/xjog-util';
import { Operation } from 'rfc6902';

export type JournalEntry = {
  id: number;
  timestamp: number;
  ref: ChartReference;

  event: EventObject | null;
  state: StateValue | null;
  context: any | null;

  stateDelta: Operation[];
  contextDelta: Operation[];
};

export type JournalEntryAutoFields = {
  id: number;
  timestamp: number;
};

export type JournalEntryInsertFields = {
  ref: ChartReference;
  event: EventObject | null;
  stateDelta: Operation[];
  contextDelta: Operation[];
};
