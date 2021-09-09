import { assign, createMachine } from 'xstate';

import { XJog, MockPersistenceAdapter } from '../src/';

describe('Assignment actions', () => {
  it('Can patch context', async () => {
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
          id: 'assignments',
          initial: 'idle',
          context: {
            steps: 0,
          },
          states: {
            idle: {
              on: {
                'take step': {
                  actions: assign({
                    steps: (context: { steps: number }) => context.steps + 1,
                  }),
                },
              },
            },
          },
        }),
      );

      await xJog.start();

      const chart = await machine.createChart();

      {
        const state = await chart.read();
        expect(state?.context).toMatchObject({
          steps: 0,
        });
      }

      {
        const state = await chart.send('take step');
        expect(state?.context).toMatchObject({
          steps: 1,
        });
      }
    } finally {
      await xJog.shutdown();
    }
  });
});
