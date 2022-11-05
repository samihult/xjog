import { EventObject, StateValue } from 'xstate';

import { ChartReference } from './ChartReference';

export type XJogStateChange = {
  type: 'create' | 'update' | 'delete';
  ref: ChartReference;
  parentRef: ChartReference | null;
  event: EventObject | null;
  // actions: [];
  // activities: [];
  old: {
    value: StateValue;
    context: any;
  } | null;
  new: {
    value: StateValue;
    context: any;
  } | null;
};
