import { v4 as uuidV4 } from 'uuid';
import { PersistedDeferredEvent } from '@samihult/xjog-core-persistence';

import {
  getCorrelationIdentifier,
  ChartIdentifier,
  ChartReference,
  ActivityRef,
} from '@samihult/xjog-util';

import { ResolvedXJogOptions } from './XJogOptions';
import { XJog } from './XJog';

/**
 * @group Deferred events
 */
export class XJogDeferredEventManager {
  private readonly options: ResolvedXJogOptions['deferredEvents'];

  /**
   * Time of the next scheduled read
   */
  private nextReadAt: number = Number.MAX_SAFE_INTEGER;
  /**
   * Timer for deferred event handling loop
   * @private
   */
  private deferredEventHandlerTimer: NodeJS.Timeout | null = null;

  /**
   * List of scheduled deferred events kept in the order of due time.
   */
  private readonly deferredEvents: PersistedDeferredEvent[] = [];

  /**
   * Deferred event timers by their `actionId`.
   * @example
   *   this.deferredEventTimers.get(actionId)
   */
  private deferredEventTimers = new Map<string | number, NodeJS.Timeout>();

  public constructor(private readonly xJog: XJog) {
    this.options = xJog.options.deferredEvents;
  }

  public get deferredEventCount(): number {
    return this.deferredEvents.length;
  }

  /**
   * Called by {@link #rescheduleNextReadAfter} and {@link #rescheduleNextReadAt}.
   * @param at
   * @param delay
   * @private
   */
  private rescheduleNextRead(at: number, delay: number): void {
    if (this.deferredEventHandlerTimer) {
      clearTimeout(this.deferredEventHandlerTimer);
    }

    this.nextReadAt = at;

    this.deferredEventHandlerTimer = setTimeout(
      this.scheduleUpcoming.bind(this),
      delay,
    );
  }

  /**
   * @param nextReadDelay
   * @private
   */
  private rescheduleNextReadAfter(nextReadDelay: number): void {
    this.rescheduleNextRead(Date.now() + nextReadDelay, nextReadDelay);
  }

  /**
   * @returns The calculated delay
   * @param due
   * @private
   */
  private rescheduleNextReadAt(due: number): number {
    const nextReadDelay = Math.max(due - Date.now(), 0);
    this.rescheduleNextRead(due, nextReadDelay);
    return nextReadDelay;
  }

  public async defer(
    PersistedDeferredEvent: Omit<
      PersistedDeferredEvent,
      'id' | 'eventId' | 'eventTo' | 'due' | 'timestamp' | 'lock'
    > & {
      eventId?: string | number;
      eventTo?: string | number | ChartReference | ActivityRef | null;
    },
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    await this.xJog.timeExecution('xjog.deferred event.defer', async () => {
      if (!PersistedDeferredEvent.eventId) {
        PersistedDeferredEvent.eventId = uuidV4();
      }

      const trace = (args: Record<string, any>) =>
        this.xJog.trace({
          cid,
          in: 'deferredEventManager.defer',
          ref: PersistedDeferredEvent.ref,
          deferredEventId: PersistedDeferredEvent.eventId,
          deferredEventName: PersistedDeferredEvent.event.name,
          ...args,
        });

      const now = Date.now();
      const dueTime = now + PersistedDeferredEvent.delay;

      trace({
        message: 'Storing deferred event to database',
        now,
        nextRead: this.nextReadAt,
        dueTime,
      });
      await this.xJog.persistence?.deferEvent(
        {
          ...PersistedDeferredEvent,
          eventTo: PersistedDeferredEvent.eventTo ?? null,
          lock: null,
        },
        cid,
      );
      trace({ message: 'Event deferred' });

      // The event is scheduled in the next read or later
      // OR scheduling has not started yet
      if (this.nextReadAt >= dueTime) {
        trace({
          message:
            'Next read is later than the due time for event, reschedule read',
          now,
          nextRead: this.nextReadAt,
          dueTime,
        });

        if (!this.deferredEvents.length) {
          this.rescheduleNextReadAt(dueTime);
        } else {
          const lastScheduledDeferredEventDue =
            this.deferredEvents[this.deferredEvents.length - 1]?.due ??
            this.options.interval;

          this.rescheduleNextReadAt(
            Math.min(dueTime, lastScheduledDeferredEventDue),
          );
        }
      }
    });
  }

  /**
   * Schedule next events.
   */
  public async scheduleUpcoming(): Promise<void> {
    const cid = getCorrelationIdentifier();

    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'deferredEventManager.scheduleUpcoming',
        ...args,
      });

    this.deferredEventHandlerTimer = null;

    // If dying, don't schedule anything new
    if (this.xJog.dying) {
      trace({ message: 'Stopping deferred event scheduling because dying' });
      return;
    }

    trace({ message: 'Taking a batch of upcoming events' });
    const deferredEvents: PersistedDeferredEvent[] =
      await this.xJog.persistence.takeUpcomingDeferredEvents(
        this.xJog.id,
        this.options.lookAhead,
        this.options.batchSize,
        cid,
      );
    trace({ message: 'Batch of events taken', count: deferredEvents.length });

    for (const PersistedDeferredEvent of deferredEvents) {
      this.schedule(PersistedDeferredEvent, cid);
    }

    // If the batch size matches with the read batch, there are probably more
    // coming up. Schedule next read right after this batches last item.
    if (deferredEvents.length === this.options.batchSize) {
      const lastDeferredEvent = deferredEvents[deferredEvents.length - 1];
      if (lastDeferredEvent) {
        trace({
          message:
            'Scheduling next read after the due time of the last deferred event',
          at: lastDeferredEvent,
        });
        this.rescheduleNextReadAt(lastDeferredEvent.due);
      } else {
        trace({ message: 'Scheduling next read immediately' });
        this.rescheduleNextReadAfter(0);
      }
    }

    // If we read less items than the batch size, there are no items to be
    // expected during the read interval. Schedule a regular read after that.
    else {
      this.rescheduleNextReadAfter(this.options.interval);
      trace({
        message: 'Scheduling next read after the regular interval',
        after: this.options.interval,
      });
    }
  }

  private schedule(
    persistedDeferredEvent: PersistedDeferredEvent,
    cid = getCorrelationIdentifier(),
  ): void {
    // Schedule the concrete event sending
    const now = Date.now();

    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'deferredEventManager.schedule',
        eventId: persistedDeferredEvent.eventId,
        id: persistedDeferredEvent.id,
        ...args,
      });

    // The time of this event may have passed already, if it
    // was purposed to be deferred to very proxime future
    let delay = persistedDeferredEvent.due - now;
    if (delay < 0) {
      trace({
        level: 'warning',
        message: 'Due time has passed already',
        delay,
      });
      delay = 0;
    }

    trace({ message: 'Scheduling deferred event', delay });
    const timer = setTimeout(async () => {
      trace({ message: 'Sending deferred event after the wait time', delay });

      if (persistedDeferredEvent.eventTo) {
        await this.xJog.sendTo(
          persistedDeferredEvent.eventTo,
          persistedDeferredEvent.eventId,
          persistedDeferredEvent.ref,
          persistedDeferredEvent.event,
          undefined,
          cid,
        );
      } else {
        const state = await this.xJog.sendEvent(
          persistedDeferredEvent.ref,
          persistedDeferredEvent.event,
          undefined,
          undefined,
          cid,
        );

        if (!state) {
          trace({ level: 'warning', message: 'Failed to send event' });
        }
      }

      trace({ message: 'Cleaning up after sending' });

      // Remove this from the list
      const eventIndex = this.deferredEvents.findIndex(
        (candidate) => candidate.id === persistedDeferredEvent.id,
      );
      this.deferredEvents.splice(eventIndex, 1);

      // Remove the timer handle
      this.deferredEventTimers.delete(persistedDeferredEvent.id);

      await this.xJog.persistence.removeDeferredEvent(
        persistedDeferredEvent,
        cid,
      );

      trace({ message: 'Done cleaning up' });
    }, delay);

    trace({ message: 'Storing timer handle' });
    this.deferredEventTimers.set(persistedDeferredEvent.id, timer);

    // Add the scheduled event to the list, keeping it in the order of due time
    trace({ message: 'Adding the event to list of scheduled events' });
    const indexOfLaterDeferredEvent = this.deferredEvents.findIndex(
      // The one we cut in line has to be either...
      (existing) =>
        // ...older than this event
        existing.due > persistedDeferredEvent.due ||
        // ...or same but inserted into database later
        (existing.due === persistedDeferredEvent.due &&
          existing.id > persistedDeferredEvent.id),
    );
    this.deferredEvents.splice(
      indexOfLaterDeferredEvent,
      0,
      persistedDeferredEvent,
    );

    trace({ message: 'Done' });
  }

  public async cancelAllForChart(
    ref: ChartReference,
    cid = getCorrelationIdentifier(),
  ) {
    const deferredEventIds = this.deferredEvents
      .filter((PersistedDeferredEvent) =>
        ChartIdentifier.from(ref)?.matches(PersistedDeferredEvent.ref),
      )
      .map((PersistedDeferredEvent) => PersistedDeferredEvent.id);

    for (const id of deferredEventIds) {
      await this.cancel(id, cid);
    }
  }

  private async unschedule(
    eventId: number | string,
    cid = getCorrelationIdentifier(),
  ): Promise<PersistedDeferredEvent | null> {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'deferredEventManager.unschedule',
        eventId,
        ...args,
      });

    trace({ message: 'Searching for deferred event' });
    const deferredEventIndex = this.deferredEvents.findIndex(
      (candidate: PersistedDeferredEvent) => candidate.eventId === eventId,
    );

    if (deferredEventIndex === -1) {
      trace({ message: 'Deferred event not scheduled' });
      return null;
    }

    const [PersistedDeferredEvent] = this.deferredEvents.splice(
      deferredEventIndex,
      1,
    );

    trace({ message: 'Clearing the event timer' });
    if (this.deferredEventTimers.has(PersistedDeferredEvent.id)) {
      clearTimeout(this.deferredEventTimers.get(PersistedDeferredEvent.id)!);
      this.deferredEventTimers.delete(PersistedDeferredEvent.id);
    }

    return PersistedDeferredEvent;
  }

  public async cancel(
    eventId: number | string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'deferredEventManager.cancel',
        eventId,
        ...args,
      });

    const PersistedDeferredEvent = await this.unschedule(eventId, cid);

    // TODO should cancel anyways, scheduled or not (just to be safe)

    if (PersistedDeferredEvent) {
      trace({ message: 'Removing event from the database' });
      await this.xJog.persistence.removeDeferredEvent(
        PersistedDeferredEvent,
        cid,
      );
    }

    trace({ message: 'Done' });
  }

  public async releaseAll() {
    if (this.deferredEventHandlerTimer) {
      clearTimeout(this.deferredEventHandlerTimer);
      this.deferredEventHandlerTimer = null;
    }

    // Cancel all deferred event timers
    for (const deferredEventTimer of this.deferredEventTimers.values()) {
      if (deferredEventTimer) {
        clearTimeout(deferredEventTimer);
      }
    }

    // Clear the deferred event list
    this.deferredEvents.splice(0);

    // Clear the deferred event timers
    this.deferredEventTimers.clear();

    await this.xJog.persistence.releaseAllDeferredEvents();
  }
}
