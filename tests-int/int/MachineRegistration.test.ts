import { createMachine } from 'xstate';

import { XJog, MockPersistenceAdapter, XJogMachine } from '../src';

const machine = createMachine({
  id: 'machine',
  initial: 'idle',
  states: {
    idle: {},
  },
});

describe('Machine registration', () => {
  it('Refuses to register machines once started', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
      },
    });

    await xJog.start();

    expect.assertions(1);
    await expect(
      async () => await xJog.registerMachine(machine),
    ).rejects.toThrow('Cannot register machines after starting XJog');

    await xJog.shutdown();
  });

  it('Can register and retrieve a new machine', async () => {
    const persistence = new MockPersistenceAdapter();
    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
      },
    });

    const xJogMachine = await xJog.registerMachine(machine);
    expect(xJogMachine).toBeInstanceOf(XJogMachine);

    expect(await xJog.getMachine(machine.id)).toBe(xJogMachine);

    await xJog.start();

    expect(await xJog.getMachine(machine.id)).toBe(xJogMachine);

    await xJog.shutdown();
  });
});
