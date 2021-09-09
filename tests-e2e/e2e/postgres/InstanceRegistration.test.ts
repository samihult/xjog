import { XJog, PostgreSQLPersistenceAdapter } from 'xjog';
import { Pool } from 'pg';

import { dbConfig } from './dbConfig';

describe('Instance registration', () => {
  let pool: Pool, persistence: PostgreSQLPersistenceAdapter;

  beforeAll(async () => {
    pool = new Pool(dbConfig);
    persistence = await PostgreSQLPersistenceAdapter.connect(pool, dbConfig);
  });

  afterAll(async () => {
    await persistence?.disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    await persistence.cleanEverything();
  });

  it('Starts, registers an instance, and shuts down without errors', async () => {
    const xJog = new XJog({ persistence });

    try {
      await xJog.start();

      const { rows } = await pool.query('SELECT * FROM "instances"');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        dying: false,
        instanceId: xJog.id,
      });
    } finally {
      await xJog?.shutdown();
    }
  });

  it('Overthrows an older instance when a new one is registered', async () => {
    const originalInstance = new XJog({ persistence });
    const usurperInstance = new XJog({ persistence });

    try {
      await originalInstance.start();

      {
        const { rows } = await pool.query('SELECT * FROM "instances"');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          dying: false,
          instanceId: originalInstance.id,
        });
      }

      await usurperInstance.start();

      {
        const { rows } = await pool.query('SELECT * FROM "instances"');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
          dying: true,
          instanceId: originalInstance.id,
        });
        expect(rows[1]).toMatchObject({
          dying: false,
          instanceId: usurperInstance.id,
        });
      }

      await originalInstance.waitUntilHalted();

      {
        const { rows } = await pool.query('SELECT * FROM "instances"');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          dying: false,
          instanceId: usurperInstance.id,
        });
      }
    } finally {
      await originalInstance?.shutdown();
      await usurperInstance?.shutdown();
    }
  });
});
