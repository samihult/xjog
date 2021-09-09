import { createMachine } from 'xstate';

import { waitFor } from '../src/util/waitFor';
import { XJog, MockPersistenceAdapter } from '../src/';

describe('Invoked machines', () => {
  it('Invokes an unregistered XState machine', async () => {
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
      const entryNotify = jest.fn();
      const exitNotify = jest.fn();

      const child = createMachine({
        id: 'child',
        initial: 'active',
        states: {
          active: {
            entry: entryNotify,
            after: {
              [delay]: { target: 'finished' },
            },
          },
          finished: { entry: exitNotify, type: 'final' },
        },
      });

      const parent = await xJog.registerMachine(
        createMachine({
          id: 'machine',
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: child,
                onDone: 'finished',
              },
            },
            finished: {
              type: 'final',
            },
          },
        }),
      );

      await xJog.start();
      await parent.createChart();

      expect(entryNotify).toHaveBeenCalled();
      expect(exitNotify).not.toHaveBeenCalled();

      await waitFor(delay);

      expect(exitNotify).toHaveBeenCalled();
    } finally {
      await xJog.shutdown();
    }
  });
});
