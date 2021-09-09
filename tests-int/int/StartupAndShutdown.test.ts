import { XJog, MockPersistenceAdapter } from '../src';

describe('Startup and shutdown', () => {
  it('Starts up and shuts down without errors', async () => {
    const persistence = new MockPersistenceAdapter();

    const xJog = new XJog({
      persistence,
      deferredEvents: {
        interval: 10,
      },
    });

    try {
      await xJog.start();
    } finally {
      await xJog.shutdown();
    }
  });
});
