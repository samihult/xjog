import { createMachine } from 'xstate';
import { interval } from 'rxjs';
import { map, take } from 'rxjs/operators';

import { waitFor } from '../src/util/waitFor';
import { XJog, MockPersistenceAdapter } from '../src/';

describe('Invoked observables', () => {
  it('Invokes an observable', async () => {
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
      const callNotify = jest.fn();

      const machine = await xJog.registerMachine(
        createMachine({
          id: 'machine',
          initial: 'counting',
          states: {
            counting: {
              invoke: {
                // Returns an observable that will yield a
                // series of 5 events, then finish.
                src: () =>
                  interval(delay).pipe(
                    map((value) => ({ type: 'count', value })),
                    take(5),
                  ),
                onDone: 'finished',
              },
              on: {
                // Each event from the observable will
                // cause this action to be executed.
                count: { actions: callNotify },
              },
            },
            finished: {
              type: 'final',
            },
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      {
        const state = await chart.read();
        expect(state?.matches('counting')).toBe(true);
        expect(callNotify).not.toHaveBeenCalled();
      }

      await waitFor(delay);

      {
        const state = await chart.read();
        expect(state?.matches('counting')).toBe(true);
        expect(callNotify).toHaveBeenCalledTimes(1);
      }

      await waitFor(delay * 4);

      {
        const state = await chart.read();
        expect(state?.matches('finished')).toBe(true);
        expect(callNotify).toHaveBeenCalledTimes(5);
      }
    } finally {
      await xJog.shutdown();
    }
  });
});
