// import { MockPersistenceAdapter } from '@xjog/core-mock';
import { PersistenceAdapter } from '@samihult/xjog-core-persistence';

import { XJogActivityManager } from './XJogActivityManager';
import { ActivityRef } from './ActivityRef';
import { XJog } from './XJog';

function mockXJogWithActivityManager(
  persistence: PersistenceAdapter,
  trace = false,
): [XJog, XJogActivityManager] {
  const xJog: any = {
    id: 'xjog-id',
    dying: false,
    persistence,
    trace: trace ? console.log : () => {},
    sendEvent: jest.fn(),
  };

  xJog.activityManager = new XJogActivityManager(xJog);

  return [xJog as unknown as XJog, xJog.activityManager];
}

function mockActivity(): [ActivityRef, () => void] {
  const unsubscribe = jest.fn();

  const activity = {
    id: 'activity-id',
    owner: { machineId: 'machine-id', chartId: 'chart-id' },
    toJSON: jest.fn(() => ({ id: 'activity-id' })),
    send: jest.fn(),
    subscribe: jest.fn(() => unsubscribe),
    stop: jest.fn(),
  };

  return [activity as unknown as ActivityRef, unsubscribe];
}

describe('XJogActivityManager', () => {
  it('Can register and unregister activities', async () => {
    const persistence = new MockPersistenceAdapter();
    const [, activityManager] = mockXJogWithActivityManager(persistence);

    const [activity] = mockActivity();

    await activityManager.registerActivity(activity);

    expect(persistence.ongoingActivities.rows[0]).toMatchObject({
      activityId: 'activity-id',
      chartId: 'chart-id',
      machineId: 'machine-id',
    });

    expect(activity.subscribe).toHaveBeenCalled();
    expect(activityManager.activityCount).toBe(1);
    // @ts-ignore Private access
    expect(activityManager.has(activity.owner!, activity.id)).toBe(true);

    await activityManager.stopAndUnregisteredActivity(activity);

    expect(persistence.ongoingActivities.rows).toHaveLength(0);

    expect(activity.stop).toHaveBeenCalled();
    expect(activityManager.activityCount).toBe(0);
    // @ts-ignore Private access
    expect(activityManager.ongoingActivities.has(activity.id)).toBe(false);
  });

  it('Can relay events to activities', async () => {
    const persistence = new MockPersistenceAdapter();
    const [, activityManager] = mockXJogWithActivityManager(persistence);

    const [activity] = mockActivity();

    await activityManager.registerActivity(activity);
    await activityManager.sendTo(activity.owner!, activity.id, 'test event');

    expect(activity.send).toHaveBeenCalledWith('test event');
  });
});
