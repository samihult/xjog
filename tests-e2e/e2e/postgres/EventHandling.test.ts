import { XJog, PostgreSQLPersistenceAdapter } from 'xjog';
import { waitFor } from 'xjog/lib/util/waitFor';
import { createMachine, assign } from 'xstate';
import { Pool } from 'pg';

// @ts-ignore Linter doesn't notice e2e/tsconfig.json
import { dbConfig } from './dbConfig';

describe('Event handling', () => {
  let pool: Pool, persistence: PostgreSQLPersistenceAdapter;

  beforeAll(async () => {
    pool = new Pool(dbConfig);
    persistence = await PostgreSQLPersistenceAdapter.connect(pool, dbConfig);
  });

  afterAll(async () => {
    await persistence?.disconnect();
    await pool?.end();
  });

  beforeEach(async () => {
    await persistence.cleanEverything();
  });

  it('State changes in reaction to events', async () => {
    const xJog = new XJog({
      persistence,
      deferredEvents: { interval: 20, lookAhead: 25 },
    });

    const delay = 35;

    try {
      const machine = await xJog.registerMachine(
        createMachine({
          id: 'event-handling-01',
          initial: 'home',
          context: {
            'good weather': true,
          },
          states: {
            home: {
              on: { 'get restless': 'choosing action' },
            },
            'choosing action': {
              always: [
                {
                  cond: (context) => context['good weather'],
                  target: 'in park',
                },
                { target: 'home' },
              ],
            },
            'in park': {
              after: {
                [delay]: {
                  target: 'home',
                  actions: assign({ 'good weather': false }),
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
        expect(state?.matches('home')).toBe(true);

        const { rows } = await pool.query('SELECT * FROM "charts"');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          machineId: machine.id,
          chartId: chart.id,
          parentMachineId: null,
          parentChartId: null,
          paused: false,
        });
      }

      {
        const state = await chart.send('get restless');
        expect(state?.matches('in park')).toBe(true);
      }

      await waitFor(50);

      {
        const state = await chart.read();
        expect(state?.matches('home')).toBe(true);
      }

      {
        const state = await chart.send('get restless');
        expect(state?.matches('home')).toBe(true);
      }
    } finally {
      await xJog?.shutdown();
    }
  });
});
