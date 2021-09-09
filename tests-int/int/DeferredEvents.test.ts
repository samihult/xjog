import { createMachine } from 'xstate';

import { waitFor } from '../src/util/waitFor';
import { XJog, MockPersistenceAdapter } from '../src/';

describe('Simple chart with deferred events', () => {
  it('Will transition and run the actions after a delay', async () => {
    const notify = jest.fn();

    const simple = createMachine({
      id: 'simple',
      initial: 'idle',
      states: {
        idle: {
          on: {
            'start working': 'working',
          },
        },
        working: {
          after: {
            'suitable time': {
              actions: () => notify(),
              target: 'idle',
            },
          },
        },
      },
    });

    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 20,
        lookAhead: 30,
      },
    });

    const machine = await xJog.registerMachine(
      simple.withConfig({
        delays: {
          'suitable time': 100,
        },
      }),
    );

    await xJog.start();

    const chart = await machine.createChart();

    {
      const state = await chart.read();
      expect(state?.matches('idle')).toBe(true);
    }

    {
      const state = await chart.send('start working');
      expect(state?.matches('working')).toBe(true);
      expect(notify).not.toHaveBeenCalled();
    }

    await waitFor(50);

    {
      const state = await chart.read();
      expect(state?.matches('working')).toBe(true);
    }

    await waitFor(100);

    {
      const state = await chart.read();
      expect(state?.matches('idle')).toBe(true);
      expect(state?.event).toMatchObject({
        type: 'xstate.after(suitable time)#simple.working',
      });
    }

    await xJog.shutdown();
  });
});
