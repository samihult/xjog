import { assign, createMachine } from 'xstate';
import { applyPatch } from 'rfc6902';

import { waitFor } from '../src/util/waitFor';

import {
  XJog,
  MockPersistenceAdapter,
  MockDeltaPersistenceAdapter,
  Window,
  DeltaEntry,
} from '../src';

describe('Deltas', () => {
  it('Records change', async () => {
    const persistence = new MockPersistenceAdapter();
    const deltaPersistence = new MockDeltaPersistenceAdapter(persistence);

    const xJog = new XJog({
      persistence,
      deltaPersistence,
      deferredEvents: { interval: 50, lookAhead: 75 },
    });

    try {
      const delay = 85;

      const machine = await xJog.registerMachine(
        createMachine({
          id: 'delta-01',
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
        expect(deltaPersistence.deltas.rows).toEqual([
          expect.objectContaining({
            event: JSON.stringify({ type: 'xstate.init' }),
            state: JSON.stringify('home'),
            stateDelta: JSON.stringify([{ op: 'replace', path: '' }]),
            context: JSON.stringify({ 'good weather': true }),
            contextDelta: JSON.stringify([{ op: 'replace', path: '' }]),
          }),
        ]);
      }

      {
        await chart.send('get restless');
        expect(deltaPersistence.deltas.rows).toEqual([
          expect.objectContaining({
            state: null,
            context: null,
          }),
          expect.objectContaining({
            event: JSON.stringify({ type: 'get restless' }),
            state: JSON.stringify('in park'),
            stateDelta: JSON.stringify([
              { op: 'replace', path: '', value: 'home' },
            ]),
            context: JSON.stringify({ 'good weather': true }),
            contextDelta: JSON.stringify([]),
          }),
        ]);
      }

      await waitFor(100);

      {
        expect(deltaPersistence.deltas.rows).toEqual([
          expect.objectContaining({
            state: null,
            context: null,
          }),
          expect.objectContaining({
            state: null,
            context: null,
          }),
          expect.objectContaining({
            event: JSON.stringify({
              type: `xstate.after(${delay})#delta-01.in park`,
            }),
            state: JSON.stringify('home'),
            stateDelta: JSON.stringify([
              { op: 'replace', path: '', value: 'in park' },
            ]),
            context: JSON.stringify({ 'good weather': false }),
            contextDelta: JSON.stringify([
              { op: 'replace', path: '/good weather', value: true },
            ]),
          }),
        ]);
      }

      {
        await chart.send('get restless');
        expect(deltaPersistence.deltas.rows).toEqual([
          expect.objectContaining({
            state: null,
            context: null,
          }),
          expect.objectContaining({
            state: null,
            context: null,
          }),
          expect.objectContaining({
            state: null,
            context: null,
          }),
          expect.objectContaining({
            event: JSON.stringify({ type: 'get restless' }),
            state: JSON.stringify('home'),
            stateDelta: JSON.stringify([]),
            context: JSON.stringify({ 'good weather': false }),
            contextDelta: JSON.stringify([]),
          }),
        ]);
      }
    } finally {
      await xJog?.shutdown();
    }
  });

  it('Provides a subscription to a window of all delta-tracked charts', async () => {
    const persistence = new MockPersistenceAdapter();
    const deltaPersistence = new MockDeltaPersistenceAdapter(persistence);

    const xJog = new XJog({
      persistence,
      deltaPersistence,
    });

    try {
      const machineOfInterest = await xJog.registerMachine(
        createMachine({
          id: 'delta-02a',
          initial: 'home',
          states: {
            home: {
              on: { 'go out': 'out' },
            },
            out: {
              initial: 'street',
              states: {
                street: {
                  on: {
                    'go to pub': 'pub',
                  },
                },
                pub: {
                  on: {
                    leave: 'street',
                  },
                },
              },
              on: {
                'go home': 'home',
              },
            },
          },
        }),
      );

      const inconsequentialMachine = await xJog.registerMachine(
        createMachine({
          id: 'delta-02b',
          initial: 'downstairs',
          states: {
            downstairs: {
              on: { 'go up': 'upstairs' },
            },
            upstairs: {
              on: { 'go down': 'downstairs' },
            },
          },
        }),
      );

      await xJog.start();
      const primaryChartA = await machineOfInterest.createChart();
      const primaryChartB = await machineOfInterest.createChart();
      const noiseChart = await inconsequentialMachine.createChart();

      const deltaWindow: DeltaEntry<any>[] = [];

      const next = jest.fn((update: Window) => {
        applyPatch(deltaWindow, update.changes);
      });
      const error = jest.fn();
      const complete = jest.fn();

      const subscription = await xJog.subscribeToDeltaCharts(
        { limit: 10, filter: { machineId: machineOfInterest.id } },
        { next, error, complete },
      );

      expect(deltaWindow).toEqual([
        expect.objectContaining({ ref: primaryChartA.ref }),
        expect.objectContaining({ ref: primaryChartB.ref }),
      ]);

      next.mockClear();

      await noiseChart.send('go up');
      expect(next).not.toHaveBeenCalled();

      await primaryChartB.send('go out');
      expect(next).toHaveBeenCalledWith({
        changes: [
          // Add at the top of the list
          {
            op: 'add',
            path: '/0',
            value: expect.objectContaining({
              id: 5,
              ownerId: xJog.id,
              ref: primaryChartB.ref,
              event: { type: 'go out' },
              state: { out: 'street' },
              context: {},
            }),
          },
          // Pop the last out to make room
          {
            op: 'remove',
            path: '/2',
          },
        ],
        size: 2,
      });

      subscription.unsubscribe();
    } finally {
      await xJog?.shutdown();
    }
  });

  it('Provides a subscription to a window of deltas of a single chart', async () => {
    const persistence = new MockPersistenceAdapter();
    const deltaPersistence = new MockDeltaPersistenceAdapter(persistence);

    const xJog = new XJog({
      persistence,
      deltaPersistence,
    });

    try {
      const machine = await xJog.registerMachine(
        createMachine({
          id: 'delta-03',
          initial: 'downstairs',
          states: {
            downstairs: {
              on: { 'go up': 'upstairs' },
            },
            upstairs: {
              on: { 'go down': 'downstairs' },
            },
          },
        }),
      );

      await xJog.start();
      const chartOfInterest = await machine.createChart();
      const inconsequentialChart = await machine.createChart();

      const deltaWindow: DeltaEntry<any>[] = [];

      const next = jest.fn((update: Window) => {
        applyPatch(deltaWindow, update.changes);
      });
      const error = jest.fn();
      const complete = jest.fn();

      const subscription = await xJog.subscribeToDeltaEntries(
        { ref: chartOfInterest.ref, limit: 10 },
        { next, error, complete },
      );

      expect(deltaWindow).toEqual([
        expect.objectContaining({
          ref: chartOfInterest.ref,
          state: 'downstairs',
        }),
      ]);

      next.mockClear();

      await inconsequentialChart.send('go up');
      expect(next).not.toHaveBeenCalled();

      await chartOfInterest.send('go up');
      expect(next).toHaveBeenCalledWith({
        changes: [
          { op: 'replace', path: '/0/id', value: 4 },
          { op: 'replace', path: '/0/event/type', value: 'go up' },
          { op: 'replace', path: '/0/state', value: 'upstairs' },
          { op: 'add', path: '/0/stateDelta/0/value', value: 'downstairs' },
          { op: 'remove', path: '/0/contextDelta/0' },
        ],
        size: 1,
      });

      subscription.unsubscribe();
    } finally {
      await xJog?.shutdown();
    }
  });
});
