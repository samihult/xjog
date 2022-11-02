import { Event, EventObject, SCXML, Subscription } from 'xstate';
import { Mutex, MutexInterface, withTimeout } from 'async-mutex';
import { getEventType, toSCXMLEvent } from 'xstate/lib/utils';
import * as actions from 'xstate/lib/actions';

import {
  ChartReference,
  getCorrelationIdentifier,
  ActivityRef,
} from '@samihult/xjog-util';

import { XJog } from './XJog';

/**
 * Ongoing activities are managed at the top level because they may
 * outlive {@link XJogMachine} or {@link XJogChart} instances.
 * @group XJog
 */
export class XJogActivityManager {
  public readonly activityMutex: MutexInterface;
  // TODO is this necessary with the other mutex?
  public readonly activityDbMutex: MutexInterface;

  /**
   * Ongoing, in-memory activities by the owning chart and their unique id.
   */
  private ongoingActivities = new Map<
    string,
    Map<string, Map<string, ActivityRef>>
  >();

  /**
   * Ongoing, in-memory activities' subscriptions by the owning chart and their unique id.
   */
  private ongoingActivitySubscriptions = new Map<
    string,
    Map<string, Map<string, Subscription>>
  >();

  /**
   * Map from `machineId` to `chartId` and ultimately to activity id.
   * Parent chart events are sent to these activities.
   * if possible.
   * @private
   */
  private autoForwards = new Map<string, Map<string, Set<string>>>();

  public constructor(private readonly xJog: XJog) {
    this.activityDbMutex = withTimeout(
      new Mutex(),
      // TODO make this configurable separately
      xJog.options.chartMutexTimeout,
    );
    this.activityMutex = withTimeout(
      new Mutex(),
      // TODO make this configurable separately
      xJog.options.chartMutexTimeout,
    );
  }

  public get activityCount(): number {
    return this.ongoingActivities.size;
  }

  public has(ref: ChartReference, actionId: string): boolean {
    return !!this.ongoingActivities
      .get(ref.machineId)
      ?.get(ref.chartId)
      ?.has(actionId);
  }

  public sendAutoForwardEvent(
    ref: ChartReference,
    event: Event<EventObject> | SCXML.Event<EventObject>,
    cid = getCorrelationIdentifier(),
  ): void {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'activityManager.sendAutoForwardEvent',
        ref,
        eventType: getEventType(event),
        ...args,
      });

    const activityIds = this.autoForwards.get(ref.machineId)?.get(ref.chartId);

    if (activityIds) {
      trace({
        message: 'Sending auto-forward events',
        count: activityIds.size,
      });

      for (const activityId of activityIds) {
        trace({
          message: 'Sending auto-forward event',
          activityId,
        });

        this.ongoingActivities
          .get(ref.machineId)
          ?.get(ref.chartId)
          ?.get(activityId)
          ?.send(event);
      }
    }
  }

  public async activityOngoing(ref: ChartReference, activityId: string) {
    const releaseMutex = await this.activityDbMutex.acquire();
    try {
      return await this.xJog.persistence.isActivityRegistered(ref, activityId);
    } finally {
      releaseMutex();
    }
  }

  public async registerActivity(
    activity: ActivityRef,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.xJog.trace(
        {
          cid,
          in: 'activityManager.registerActivity',
          id: activity.id,
          owner: activity.owner,
        },
        ...args,
      );

    if (!activity.owner || !activity.id) {
      throw new Error('Regular activities must have an owner and an id');
    }

    trace('Acquiring mutex');
    const releaseMutex = await this.activityMutex.acquire();

    try {
      trace('Registering activity');

      if (!this.ongoingActivities.has(activity.owner.machineId)) {
        this.ongoingActivities.set(activity.owner.machineId, new Map());
      }

      if (!this.ongoingActivitySubscriptions.has(activity.owner.machineId)) {
        this.ongoingActivitySubscriptions.set(
          activity.owner.machineId,
          new Map(),
        );
      }

      if (
        !this.ongoingActivities
          .get(activity.owner.machineId)
          ?.has(activity.owner.chartId)
      ) {
        this.ongoingActivities
          .get(activity.owner.machineId)
          ?.set(activity.owner.chartId, new Map());
      }

      if (
        !this.ongoingActivitySubscriptions
          .get(activity.owner.machineId)
          ?.has(activity.owner.chartId)
      ) {
        this.ongoingActivitySubscriptions
          .get(activity.owner.machineId)
          ?.set(activity.owner.chartId, new Map());
      }

      this.ongoingActivities
        .get(activity.owner.machineId)
        ?.get(activity.owner.chartId)
        ?.set(activity.id, activity);

      trace({
        in: 'activityManager.registerActivity',
        message: 'Registered activity, subscribing',
      });

      const subscription = activity.subscribe({
        next: (value) => {
          trace({
            in: 'activityManager.subscriber',
            message: 'Activity emitted a value',
            value,
          });

          if (activity.owner) {
            trace({
              in: 'activityManager.subscriber',
              message: 'Notifying owner',
              value,
            });

            this.xJog.deferredEventManager.defer(
              {
                ref: activity.owner,
                delay: 0,
                event: toSCXMLEvent(value),
              },
              cid,
            );
          }
        },

        error: (error) => {
          trace({
            level: 'debug',
            in: 'activityManager.subscriber',
            message: 'Activity emitted an error',
            error,
          });

          if (activity.owner) {
            trace({
              in: 'activityManager.subscriber',
              message: 'Notifying owner',
              error,
            });

            this.xJog.sendEvent(
              activity.owner,
              actions.error(activity.id, error),
            );
          }
        },

        complete: () => {
          trace({
            in: 'activityManager.subscriber',
            message: 'Activity completed',
          });

          if (activity.owner) {
            trace({
              in: 'activityManager.subscriber',
              message: 'Stopping activity',
            });

            this.stopActivity(activity.owner, activity.id);
          }
        },
      });

      this.ongoingActivitySubscriptions
        .get(activity.owner.machineId)
        ?.get(activity.owner.chartId)
        ?.set(activity.id, subscription);

      if (activity.owner) {
        trace({
          in: 'activityManager.registerActivity',
          message: 'Storing activity to the database',
        });

        const releaseDbMutex = await this.activityDbMutex.acquire();

        await this.xJog.persistence.registerActivity(
          activity.owner,
          activity.id,
          cid,
        );

        releaseDbMutex();

        if (activity.autoForward) {
          trace({
            in: 'activityManager.registerActivity',
            message: 'Registering auto-forward receivers',
          });

          if (!this.autoForwards.has(activity.owner.machineId)) {
            this.autoForwards.set(activity.owner.machineId, new Map());
          }

          if (
            !this.autoForwards
              .get(activity.owner.machineId)
              ?.has(activity.owner.chartId)
          ) {
            this.autoForwards
              .get(activity.owner.machineId)
              ?.set(activity.owner.chartId, new Set());
          }

          this.autoForwards
            .get(activity.owner.machineId)
            ?.get(activity.owner.chartId)
            ?.add(activity.id);

          trace({
            in: 'activityManager.registerActivity',
            message: 'Registered auto-forward receivers',
          });
        }
      }
    } finally {
      trace('Releasing mutex');
      releaseMutex();
    }
  }

  public sendTo<TEvent extends EventObject>(
    ref: ChartReference,
    activityId: string,
    event: Event<TEvent> | SCXML.Event<TEvent>,
    cid = getCorrelationIdentifier(),
  ) {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'activityManager.sendTo',
        ref,
        activityId,
        eventType: toSCXMLEvent(event).name,
        ...args,
      });

    trace({ message: 'Sending event to an activity' });

    this.ongoingActivities
      .get(ref.machineId)
      ?.get(ref.chartId)
      ?.get(activityId)
      ?.send(event);
  }

  public async stopActivity(
    ref: ChartReference,
    activityId: string,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.xJog.trace(
        {
          cid,
          in: 'activityManager.stopActivity',
          ref,
          activityId,
        },
        ...args,
      );

    trace('Acquiring mutex');
    const releaseMutex = await this.activityMutex.acquire();

    try {
      trace({ message: 'Attempting to stop activity' });

      const activity = this.ongoingActivities
        .get(ref.machineId)
        ?.get(ref.chartId)
        ?.get(activityId);

      if (activity) {
        await this.stopAndUnregisteredActivity(activity, cid);
        trace({ message: 'Stopped and unregistered activity' });
      } else {
        trace({ level: 'warning', message: 'Activity not found' });
      }
    } finally {
      trace('Releasing mutex');
      releaseMutex();
    }
  }

  public async stopAndUnregisteredActivity(
    activity: ActivityRef,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (...args: Array<string | Record<string, unknown>>) =>
      this.xJog.trace(
        {
          cid,
          in: 'activityManager.stopAndUnregisteredActivity',
          owner: activity.owner,
          activityId: activity.id,
        },
        ...args,
      );

    trace('Acquiring mutex');
    const releaseMutex = await this.activityMutex.acquire();

    try {
      trace({ message: 'Stopping activity' });
      await activity.stop?.();

      trace({ message: 'Unregistering activity' });
      await this.unregisterActivity(activity, cid);
    } finally {
      trace('Releasing mutex');
      releaseMutex();
    }
  }

  private async unregisterActivity(
    activity: ActivityRef,
    cid = getCorrelationIdentifier(),
  ) {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'activityManager.unregisterActivity',
        owner: activity.owner,
        activityId: activity.id,
        ...args,
      });

    if (!activity.owner) {
      trace({ message: 'Activity has no owner, skipping' });
      // Not registered here
      return;
    }

    trace({ message: 'Attempting to unregister the activity' });

    this.ongoingActivities
      .get(activity.owner.machineId)
      ?.get(activity.owner.chartId)
      ?.delete(activity.id);

    if (
      this.ongoingActivities
        .get(activity.owner.machineId)
        ?.get(activity.owner.chartId)?.size === 0
    ) {
      this.ongoingActivities
        .get(activity.owner.machineId)
        ?.delete(activity.owner.chartId);
      trace({ message: 'Deleted the chart activity set' });
    }

    if (this.ongoingActivities.get(activity.owner.machineId)?.size === 0) {
      this.ongoingActivities.delete(activity.owner.machineId);
      trace({ message: 'Deleted the machine activity map' });
    }

    if (activity.owner) {
      trace({ message: 'Unregistering auto-forward' });

      this.autoForwards
        .get(activity.owner.machineId)
        ?.get(activity.owner.chartId)
        ?.delete(activity.id);

      if (
        this.autoForwards
          .get(activity.owner.machineId)
          ?.get(activity.owner.chartId)?.size === 0
      ) {
        this.autoForwards
          .get(activity.owner.machineId)
          ?.delete(activity.owner.chartId);
        trace({ message: 'Deleted the chart auto-forward set' });
      }

      if (this.autoForwards.get(activity.owner.machineId)?.size === 0) {
        this.autoForwards.delete(activity.owner.machineId);
        trace({ message: 'Deleted the machine auto-forward map' });
      }
    }

    if (activity.owner) {
      trace({ message: 'Removing the activity from the database' });

      const releaseMutex = await this.activityDbMutex.acquire();

      await this.xJog.persistence.unregisterActivity(
        activity.owner,
        activity.id,
        cid,
      );

      releaseMutex();
    } else {
      trace({
        level: 'warning',
        message: 'No owner, skipping removing the activity from the database',
      });
    }
  }

  public async stopAllForChart(
    ref: ChartReference,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'activityManager.stopAllForChart',
        ref,
        ...args,
      });

    for (const activity of this.ongoingActivities
      .get(ref.machineId)
      ?.get(ref.chartId)
      ?.values() ?? []) {
      trace({
        message: 'Stopping and unregistering activity',
        activityId: activity.id,
      });
      await this.stopAndUnregisteredActivity(activity, cid);
    }
  }

  public async stopAllActivities(
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'activityManager.stopAllActivities',
        ...args,
      });

    trace({ message: 'Stopping all activities' });

    for (const machine of this.ongoingActivities.values()) {
      for (const chart of machine.values()) {
        for (const activity of chart.values()) {
          trace({
            message: 'Stopping and unregistering activity',
            activityId: activity.id,
          });
          await this.stopAndUnregisteredActivity(activity, cid);
        }
        chart.clear();
      }
      machine.clear();
    }

    trace({ message: 'Clearing all the activities' });
    this.ongoingActivities.clear();
  }
}
