import { assign, createMachine } from 'xstate';

import { XJog, MockPersistenceAdapter } from '../src';

describe('Handover', () => {
  it('Can successfully hand over simple charts', async () => {
    const machine = createMachine({
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

    const persistence = new MockPersistenceAdapter();

    const originalXJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
      },
    });

    const usurperXJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
      },
    });

    try {
      const originalMachine = await originalXJog.registerMachine(machine);
      await originalXJog.start();

      const busyChart = await originalMachine.createChart();
      await busyChart.send('start working');

      const lazyChart = await originalMachine.createChart();

      await usurperXJog.registerMachine(machine);
      await usurperXJog.start();

      await originalXJog.waitUntilHalted();

      const newBusyChart = await usurperXJog.getChart(busyChart.ref);
      {
        const busyState = await newBusyChart?.read();
        expect(busyState?.matches('working'));
      }

      const newLazyChart = await usurperXJog.getChart(lazyChart.ref);
      {
        const lazyState = await newLazyChart?.read();
        expect(lazyState?.matches('idle'));
      }
    } finally {
      await originalXJog.shutdown();
      await usurperXJog.shutdown();
    }
  });

  it('Can successfully hand over charts with ongoing activities', async () => {
    const machine = createMachine({
      id: 'simple',
      initial: 'idle',
      context: {
        calls: 0,
      },
      states: {
        idle: {
          on: {
            'start working': 'working',
          },
        },
        working: {
          entry: assign({
            calls: (context: { calls: number }) => context.calls + 1,
          }),
          invoke: {
            src: (context, event) =>
              new Promise<void>(() => {
                expect(context.calls).toBeGreaterThan(0);
                // Will never finish
              }),
          },
          on: {
            'finish the work': 'idle',
          },
        },
      },
    });

    const persistence = new MockPersistenceAdapter();

    const originalXJog = new XJog({
      persistence,
      shutdown: {
        ownChartPollingFrequency: 10,
      },
    });

    const usurperXJog = new XJog({
      persistence,
      startup: {
        adoptionFrequency: 10,
        gracePeriod: 75,
      },
    });

    try {
      const originalMachine = await originalXJog.registerMachine(machine);
      await originalXJog.start();

      const busyChart = await originalMachine.createChart('busy');
      {
        const busyState = await busyChart.send('start working');
        expect(busyState?.matches('working')).toBe(true);
      }

      expect(originalXJog.activityManager.activityCount).toBe(1);

      const lazyChart = await originalMachine.createChart('lazy');
      {
        const lazyState = await lazyChart.read();
        expect(lazyState?.matches('idle')).toBe(true);
      }

      await usurperXJog.registerMachine(machine);
      await usurperXJog.start();
      await originalXJog.waitUntilHalted();
      await usurperXJog.waitUntilReady();

      const newBusyChart = await usurperXJog.getChart(busyChart.ref);
      {
        const busyState = await newBusyChart?.read();
        expect(busyState?.matches('working'));
      }

      const newLazyChart = await usurperXJog.getChart(lazyChart.ref);
      {
        const lazyState = await newLazyChart?.read();
        expect(lazyState?.matches('idle'));
      }

      expect(originalXJog.activityManager.activityCount).toBe(0);
      expect(usurperXJog.activityManager.activityCount).toBe(1);
    } finally {
      await originalXJog.shutdown();
      await usurperXJog.shutdown();
    }
  });
});
