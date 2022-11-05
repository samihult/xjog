import { EventObject, StateValue } from 'xstate';
import { ChartReference, XJogStateChangeAction } from "@samihult/xjog-util";

export type FullStateEntry = {
  id: number;
  created: number;
  timestamp: number;

  ownerId: string;
  ref: ChartReference;
  parentRef: ChartReference | null;

  event: EventObject | null;
  state: StateValue | null;
  context: any | null;
  actions: XJogStateChangeAction[];
};
