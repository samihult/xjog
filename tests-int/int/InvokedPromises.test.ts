import { createMachine } from 'xstate';

import { waitFor } from '../src/util/waitFor';
import { XJog, MockPersistenceAdapter } from '../src/';

describe('Invoked promises', () => {
  it('Invokes non-resolving promise', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
        lookAhead: 15,
      },
    });

    try {
      const notify = jest.fn();

      const machine = await xJog.registerMachine(
        createMachine({
          id: 'simple',
          initial: 'working',
          states: {
            working: {
              invoke: {
                src: () => {
                  notify();
                  return new Promise(() => {});
                },
                onDone: 'done',
                onError: 'error',
              },
            },
            error: { type: 'final' },
            done: { type: 'final' },
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      {
        const state = await chart.read();
        expect(state?.matches('working')).toBe(true);
        expect(xJog.activityManager.activityCount).toBe(1);

        expect(notify).toHaveBeenCalled();
      }

      {
        const state = await chart.read();
        expect(state?.matches('working')).toBe(true);
        expect(xJog.activityManager.activityCount).toBe(1);
      }
    } finally {
      await xJog.shutdown();
    }
  });

  it('Invokes and finishes a resolving promise', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
        lookAhead: 15,
      },
    });

    try {
      const notify = jest.fn();

      const machine = await xJog.registerMachine(
        createMachine({
          id: 'simple',
          initial: 'working',
          states: {
            working: {
              invoke: {
                src: async () => {
                  await waitFor(50);
                  notify();
                },
                onDone: 'done',
                onError: 'error',
              },
            },
            error: { type: 'final' },
            done: { type: 'final' },
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      const state = await chart.read();
      expect(state?.matches('working')).toBe(true);
      expect(xJog.activityManager.activityCount).toBe(1);
      expect(notify).not.toHaveBeenCalled();

      await chart.waitForFinalState(100);

      expect(notify).toHaveBeenCalled();
    } finally {
      await xJog.shutdown();
    }
  });

  it('Invokes and finishes a rejecting promise', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
        lookAhead: 15,
      },
    });

    try {
      const machine = await xJog.registerMachine(
        createMachine({
          id: 'simple',
          initial: 'working',
          states: {
            working: {
              invoke: {
                src: async () => {
                  throw new Error('Test');
                },
                onDone: 'done',
                onError: 'error',
              },
            },
            error: { type: 'final', data: () => 'Stevie' },
            done: { type: 'final', data: () => 'Robin' },
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      {
        const state = await chart.read();
        expect(state?.matches('working')).toBe(true);
      }

      const doneData = await chart.waitForFinalState(100);

      {
        const state = await chart.read();
        expect(state?.matches('error')).toBe(true);
        expect(doneData).toBe('Stevie');
      }
    } finally {
      await xJog.shutdown();
    }
  });

  it('Returns data from the promise', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
        lookAhead: 15,
      },
    });

    const isSinner = jest.fn((context, event) => event.data.numberOfSins > 0);

    try {
      const machine = await xJog.registerMachine(
        createMachine({
          id: 'simple',
          initial: 'working',
          states: {
            working: {
              invoke: {
                src: async () => {
                  return { numberOfSins: 0 };
                },
                onDone: [
                  {
                    cond: isSinner,
                    target: 'bad',
                  },
                  { target: 'fine' },
                ],
              },
            },
            fine: { type: 'final' },
            bad: { type: 'final' },
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      {
        const state = await chart.read();
        expect(state?.matches('working')).toBe(true);
      }

      await chart.waitForFinalState(100);

      {
        const state = await chart.read();
        expect(state?.matches('fine')).toBe(true);
        expect(isSinner).toHaveBeenCalled();
      }
    } finally {
      await xJog.shutdown();
    }
  });
});
