import { createMachine, assign } from 'xstate';
import { applyPatch } from 'rfc6902';
import { Pool } from 'pg';

import {
  XJog,
  DeltaEntry,
  PostgreSQLPersistenceAdapter,
  PostgreSQLDeltaPersistenceAdapter,
} from 'xjog';

// @ts-ignore Linter doesn't notice e2e/tsconfig.json
import { dbConfig } from './dbConfig';

describe('Delta streaming', () => {
  let pool: Pool,
    persistence: PostgreSQLPersistenceAdapter,
    deltaPersistence: PostgreSQLDeltaPersistenceAdapter;

  const logLocation = (location: string) =>
    assign({
      path: (context: any) => {
        return [...context.path, location];
      },
    });

  const walkAboutMachine = createMachine({
    id: 'delta-01',
    initial: 'at home',
    context: {
      path: [],
    },
    states: {
      'at home': { entry: logLocation('home') },
      'in park': { entry: logLocation('park') },
      'at diner': { entry: logLocation('double R') },
    },
    on: {
      'go home': '.at home',
      'go to park': '.in park',
      'go to diner': '.at diner',
    },
  });

  beforeAll(async () => {
    pool = new Pool(dbConfig);
    persistence = await PostgreSQLPersistenceAdapter.connect(pool, dbConfig);
    deltaPersistence = await PostgreSQLDeltaPersistenceAdapter.connect(
      pool,
      dbConfig,
      persistence,
    );
  });

  afterAll(async () => {
    await deltaPersistence?.disconnect();
    await persistence?.disconnect();
    await pool?.end();
  });

  beforeEach(async () => {
    await deltaPersistence.cleanEverything();
    await persistence.cleanEverything();
  });

  it('Collects delta data', async () => {
    const xJog = new XJog({
      persistence,
      deltaPersistence,
    });

    try {
      const machine = await xJog.registerMachine<any>(walkAboutMachine);

      await xJog.start();
      const chart = await machine.createChart();

      await chart.send('go to park');
      await chart.send('go to diner');
      await chart.send('go to park');
      await chart.send('go home');

      {
        const { rows } = await pool.query(
          'SELECT * FROM "deltas" ORDER BY "id" ASC',
        );

        for (const row of rows) {
          expect(row).toMatchObject({
            ownerId: xJog.id,
            machineId: machine.id,
            chartId: chart.id,
          });
        }

        expect(rows).toEqual([
          expect.objectContaining({
            event: JSON.stringify({ type: 'xstate.init' }),
          }),
          expect.objectContaining({
            event: JSON.stringify({ type: 'go to park' }),
          }),
          expect.objectContaining({
            event: JSON.stringify({ type: 'go to diner' }),
          }),
          expect.objectContaining({
            event: JSON.stringify({ type: 'go to park' }),
          }),
          expect.objectContaining({
            event: JSON.stringify({ type: 'go home' }),
          }),
        ]);

        expect(rows).toEqual([
          expect.objectContaining({
            state: null,
            stateDelta: JSON.stringify([{ op: 'replace', path: '' }]),
            context: null,
            contextDelta: JSON.stringify([{ op: 'replace', path: '' }]),
          }),
          expect.objectContaining({
            state: null,
            stateDelta: JSON.stringify([
              { op: 'replace', path: '', value: 'at home' },
            ]),
            context: null,
            contextDelta: JSON.stringify([{ op: 'remove', path: '/path/2' }]), // TODO ←- should be /1
          }),
          expect.objectContaining({
            state: null,
            stateDelta: JSON.stringify([
              { op: 'replace', path: '', value: 'in park' },
            ]),
            context: null,
            contextDelta: JSON.stringify([{ op: 'remove', path: '/path/3' }]), // TODO ←- should be /2
          }),
          expect.objectContaining({
            state: null,
            stateDelta: JSON.stringify([
              { op: 'replace', path: '', value: 'at diner' },
            ]),
            context: null,
            contextDelta: JSON.stringify([{ op: 'remove', path: '/path/4' }]), // TODO ←- should be /3
          }),
          expect.objectContaining({
            state: JSON.stringify('at home'),
            stateDelta: JSON.stringify([
              { op: 'replace', path: '', value: 'in park' },
            ]),
            context: JSON.stringify({
              path: ['home', 'home', 'park', 'double R', 'park', 'home'],
            }), // TODO ← should be single "home"
            contextDelta: JSON.stringify([{ op: 'remove', path: '/path/5' }]), // TODO ← should be /4
          }),
        ]);
      }
    } finally {
      await xJog?.shutdown();
    }
  });

  it('Emits delta stream', async () => {
    const xJog = new XJog({
      persistence,
      deltaPersistence,
    });

    let subscription;

    try {
      const machine = await xJog.registerMachine<any>(walkAboutMachine);

      await xJog.start();
      const chart = await machine.createChart();

      const deltas: DeltaEntry<any>[] = [];

      const next = jest.fn((update) => {
        applyPatch(deltas, update.changes);
      });
      const error = jest.fn();
      const complete = jest.fn();

      subscription = await xJog.subscribeToDeltaCharts(
        { limit: 3 },
        { next, error, complete },
      );

      expect(next).toHaveBeenCalledWith({
        changes: [
          {
            op: 'add',
            path: '/-',
            value: expect.objectContaining({
              context: { path: ['home', 'home'] }, // TODO ← should be single 'home'
              event: { type: 'xstate.init' },
              ownerId: xJog.id,
              ref: chart.ref,
              state: 'at home',
            }),
          },
        ],
        size: 1,
      });
      next.mockClear();

      await chart.send('go to park');

      // The initial deltas
      expect(next).toHaveBeenCalledWith({
        size: 1,
        changes: [
          expect.objectContaining({ op: 'replace', path: '/0/id' }),
          { op: 'replace', path: '/0/event/type', value: 'go to park' },
          { op: 'replace', path: '/0/state', value: 'in park' },
          { op: 'add', path: '/0/context/path/-', value: 'park' },
        ],
      });

      await chart.send('go to diner');
      await chart.send('go to park');
      await chart.send('go home');

      expect(deltas).toHaveLength(1);
      expect(deltas[0]).toMatchObject({
        state: 'at home',
        context: {
          // TODO ↓ should be a single 'home' in the beginning
          path: ['home', 'home', 'park', 'double R', 'park', 'home'],
        },
        event: { type: 'go home' },
      });
    } finally {
      subscription?.unsubscribe();
      await xJog?.shutdown();
    }
  });
});
