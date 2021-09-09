import { Event, EventObject, SCXML, Subscribable } from 'xstate';

import { ChartIdentifier } from './ChartIdentifier';
import { ChartReference } from './ChartReference';

// TODO this needs to change somehow

/**
 * Subscribable interface provides a stream of events that this activity emits.
 * - Promises can emit a single DoneEvent before completing
 * - Other activities can emit a stream of any events before completing
 */

export interface ActivityRef
  extends Subscribable<Event<EventObject> | SCXML.Event<EventObject>> {
  /**
   * The invoke action's id. Common to all invocations of this activity.
   */
  id: string;

  /**
   * Each activity, regardless of its type, may have an owner chart.
   * This is required for keeping track of ongoing activity count.
   * Only XJogCharts with no parent will have `null` owner.
   */
  owner: ChartReference | null;

  /**
   * Send owner's all events to this activity, if supported by the
   * activity type.
   */
  autoForward: boolean;

  /**
   * - Promise-like activities cannot receive events, so for them, this is a no-op
   */
  send: (event: Event<EventObject> | SCXML.Event<EventObject>) => any;

  /**
   * - Promises cannot be cancelled, but promise-like activities will be written
   *   off and their resolution does not reflect back to the chart
   */
  stop?: () => void;

  /**
   * Returns an object for serializing the activity. For logging and debugging
   * purposes.
   */
  toJSON?: () => any;
}

export function isActivityRef(input: any): input is ActivityRef {
  if (typeof input !== 'object' && input === null) {
    return false;
  }

  if (typeof input.id !== 'string') {
    return false;
  }

  if (input.owner !== null && !ChartIdentifier.isChartReference(input.owner)) {
    return false;
  }

  if (typeof input.send !== 'function') {
    return false;
  }

  // noinspection RedundantIfStatementJS
  if (typeof input.subscribe !== 'function') {
    return false;
  }

  return true;
}
