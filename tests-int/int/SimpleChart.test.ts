import { createMachine } from 'xstate';

import { XJog, MockPersistenceAdapter } from '../src';

describe('Simple chart', () => {
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
        on: {
          'finish the work': 'idle',
        },
      },
    },
  });

  it('Can be successfully run', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
      },
    });

    const machine = await xJog.registerMachine(simple);

    await xJog.start();

    const chart = await machine.createChart();

    {
      const state = await chart.read();
      expect(state?.matches('idle')).toBe(true);
    }

    {
      const state = await chart.send('start working');
      expect(state?.matches('working')).toBe(true);
    }

    {
      const state = await chart.send('finish the work');
      expect(state?.matches('idle')).toBe(true);
    }

    await xJog.shutdown();
  });

  it('Can be put away and rehydrated', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
      },
    });

    const machine = await xJog.registerMachine(simple);

    await xJog.start();

    const chart = await machine.createChart();

    {
      const state = await chart.read();
      expect(state?.matches('idle')).toBe(true);
    }

    {
      const state = await chart.send('start working');
      expect(state?.matches('working')).toBe(true);
    }

    const rehydratedChart = await machine.getChart(chart.id);
    expect(rehydratedChart?.id).toBe(chart.id);

    {
      const state = await rehydratedChart?.read();
      expect(state?.matches('working')).toBe(true);
    }

    {
      const state = await rehydratedChart?.send('finish the work');
      expect(state?.matches('idle')).toBe(true);
    }

    await xJog.shutdown();
  });
});
