import { EventObject, SCXML, StateConfig } from 'xstate';
import { ChartReference, ActivityRef } from '@samihult/xjog-util';

/**
 * Row in the `instances` table as returned by a persistence adapter.
 * @group Persistence
 */
export type PersistedInstance = {
  timestamp: number;
  instanceId: string;
  dying: boolean;
};

/**
 * Row in the `charts` table as returned by a persistence adapter.
 * @group Persistence
 */
export type PersistedChart<TContext, TEvent extends EventObject> = {
  timestamp: number;

  ownerId: string;
  ref: ChartReference;
  parentRef: ChartReference | null;

  state: StateConfig<TContext, TEvent>;

  paused: boolean;
};

/**
 * Row in the `deferredEvents` table as returned by a persistence adapter.
 * @group Persistence
 */
export type PersistedOngoingActivity = {
  timestamp: number;

  machineId: string;
  chartId: string;
  activityId: string;
};

/**
 * Row in the `deferredEvents` table as returned by a persistence adapter.
 * @group Persistence
 */
export type PersistedDeferredEvent = {
  id: number;

  ref: ChartReference;

  eventId: string | number;
  eventTo: string | number | ChartReference | ActivityRef | null;
  event: SCXML.Event<any>;

  /** Timestamp as milliseconds since UNIX epoch */
  timestamp: number;
  /** Delay as milliseconds */
  delay: number;
  /** Due time as milliseconds since UNIX epoch */
  due: number;

  lock: string | null;
};

/**
 * Row in the `externalIds` table as returned by a persistence adapter.
 * @group Persistence
 */
export type PersistedExternalId = {
  key: string;
  value: string;

  ref: ChartReference;
};
