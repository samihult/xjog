import { createMachine, send } from 'xstate';

import { waitFor } from '../src/util/waitFor';
import { XJog, MockPersistenceAdapter } from '../src/';

describe('Invoked callbacks', () => {
  it('Invokes a callback that sends a few events and finishes', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
        lookAhead: 15,
      },
    });

    const delay = 20;

    try {
      const startNotify = jest.fn();
      const cleanupNotify = jest.fn();

      const machine = await xJog.registerMachine(
        createMachine({
          id: 'machine',
          type: 'parallel',
          states: {
            labour: {
              initial: 'idle',
              states: {
                idle: {
                  on: {
                    'start working': 'working',
                  },
                },
                working: {
                  invoke: {
                    src: (context, event) => {
                      return (send, onReceive) => {
                        startNotify();

                        waitFor(delay)
                          .then(() => send('some work done'))
                          .then(() => waitFor(delay))
                          .then(() => send('some work done'));

                        return () => cleanupNotify();
                      };
                    },
                    onDone: 'done',
                    onError: 'error',
                  },
                },
                error: { type: 'final' },
                done: { type: 'final' },
              },
            },
            status: {
              initial: 'not started',
              states: {
                'not started': {
                  on: { 'some work done': 'almost there' },
                },
                'almost there': {
                  on: { 'some work done': 'everything done' },
                },
                'everything done': { type: 'final' },
              },
            },
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      {
        const state = await chart.read();
        expect(
          state?.matches({
            labour: 'idle',
            status: 'not started',
          }),
        ).toBe(true);
        expect(startNotify).not.toHaveBeenCalled();
      }

      {
        const state = await chart.send('start working');
        expect(
          state?.matches({
            labour: 'working',
            status: 'not started',
          }),
        ).toBe(true);
        expect(xJog.activityManager.activityCount).toBe(1);
        expect(startNotify).toHaveBeenCalled();
      }

      await waitFor(delay);

      {
        const state = await chart.read();
        expect(
          state?.matches({
            labour: 'working',
            status: 'almost there',
          }),
        ).toBe(true);
        expect(xJog.activityManager.activityCount).toBe(1);
      }

      await waitFor(delay);

      {
        const state = await chart.read();
        expect(
          state?.matches({
            labour: 'working',
            status: 'everything done',
          }),
        ).toBe(true);
      }

      // Callbacks never finish
      expect(xJog.activityManager.activityCount).toBe(1);
      expect(cleanupNotify).not.toHaveBeenCalled();
    } finally {
      await xJog.shutdown();
    }
  });

  it('Invokes a callback with two-directional communication', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
        lookAhead: 15,
      },
    });

    const delay = 20;

    try {
      const startNotify = jest.fn();
      const callNotify = jest.fn();
      const cleanupNotify = jest.fn();

      const xStateMachine = createMachine({
        id: 'machine',
        initial: 'working',
        states: {
          working: {
            initial: 'eeny',
            states: {
              eeny: {
                entry: send('fee', { to: 'nursery rhyme' }),
                on: { next: 'meeny' },
              },
              meeny: {
                entry: send('fi', { to: 'nursery rhyme' }),
                on: { next: 'miny' },
              },
              miny: {
                entry: send('fo', { to: 'nursery rhyme' }),
                on: { next: 'moe' },
              },
              moe: {
                entry: send('fum', { to: 'nursery rhyme' }),
                on: { next: 'eeny' },
              },
            },
            invoke: {
              id: 'nursery rhyme',
              src: () => {
                return (send, onReceive) => {
                  startNotify();

                  onReceive((event) => {
                    callNotify(event.name);
                    if (event.name !== 'next') {
                      waitFor(delay).then(() => send('next'));
                    }
                  });
                };
              },
            },
          },
        },
      });
      const machine = await xJog.registerMachine(xStateMachine);

      await xJog.start();

      const chart = await machine.createChart();

      {
        await chart.waitForNextState('working.meeny');
        expect(xJog.activityManager.activityCount).toBe(1);
        expect(callNotify).toHaveBeenCalledWith('fee');
        expect(callNotify).not.toHaveBeenCalledWith('fi');
      }

      {
        await chart.waitForNextState('working.miny');
        expect(xJog.activityManager.activityCount).toBe(1);
        expect(callNotify).toHaveBeenCalledWith('fi');
        expect(callNotify).not.toHaveBeenCalledWith('fo');
      }

      {
        await chart.waitForNextState('working.moe');
        expect(xJog.activityManager.activityCount).toBe(1);
        expect(callNotify).toHaveBeenCalledWith('fo');
        expect(callNotify).not.toHaveBeenCalledWith('fum');
      }

      {
        await chart.waitForNextState('working.eeny');
        expect(xJog.activityManager.activityCount).toBe(1);
        expect(callNotify).toHaveBeenCalledWith('fum');
      }

      // Callbacks never finish
      expect(xJog.activityManager.activityCount).toBe(1);
      expect(cleanupNotify).not.toHaveBeenCalled();
    } finally {
      await xJog.shutdown();
    }
  });

  it('Invokes a callback that throws error at initial call', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
        lookAhead: 15,
      },
    });

    try {
      const startNotify = jest.fn();

      const machine = await xJog.registerMachine(
        createMachine({
          id: 'machine',
          initial: 'working',
          states: {
            working: {
              invoke: {
                src: () => {
                  return () => {
                    startNotify();
                    throw new Error('Test');
                  };
                },
                onError: 'error',
              },
            },
            error: {},
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      const { state } = await chart.waitForNextState('error', 20);

      expect(state?.matches('error')).toBe(true);
      expect(xJog.activityManager.activityCount).toBe(0);
      expect(startNotify).toHaveBeenCalled();
    } finally {
      await xJog.shutdown();
    }
  });

  it('Invokes a callback that throws error while receiving an event', async () => {
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
          id: 'machine',
          initial: 'working',
          states: {
            working: {
              invoke: {
                src: (context, event) => {
                  return (send, onReceive) => {
                    onReceive((event) => {
                      throw new Error('Test');
                    });
                  };
                },
                onError: 'error',
              },
            },
            error: {},
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      const state = await chart.read();
      expect(state?.matches('working')).toBe(true);
      expect(xJog.activityManager.activityCount).toBe(1);
    } finally {
      await xJog.shutdown();
    }
  });
});
