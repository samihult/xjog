import { ClientConfig, Pool, PoolClient, PoolConfig } from 'pg';
import migrationRunner from 'node-pg-migrate';
import bind from 'pg-bind';
import path from 'path';

import {
  getCorrelationIdentifier,
  ChartIdentifier,
  ChartReference,
} from '@samihult/xjog-util';

import {
  PersistenceAdapter,
  PersistedChart,
  PersistedDeferredEvent,
} from '@samihult/xjog-core-persistence';

import {
  State,
  EventObject,
  StateSchema,
  Typestate,
  StateConfig,
} from 'xstate';

/**
 * Options for instantiating {@link PostgresPersistenceAdapter}.
 */
export type PostgreSQLPersistenceAdapterOptions = {};

/**
 * Chart row directly from the SQL query
 */
type PostgreSQLChartRow = {
  timestamp: number;
  ownerId: string;
  machineId: string;
  chartId: string;
  parentMachineId: string;
  parentChartId: string;
  state: Buffer;
  paused: boolean;
};

/**
 * Deferred event row directly from the SQL query
 */
type PostgreSQLDeferredEventRow = {
  id: number;
  machineId: string;
  chartId: string;
  eventId: string;
  eventTo: string;
  event: string;
  timestamp: number;
  delay: number;
  due: number;
  lock: string;
};

/**
 * Use the static method [connect]{@link PostgresPersistenceAdapter.connect} to
 * create an instance of this {@link PersistenceAdapter PersistenceAdapter} for
 * [PostgreSql](https://www.postgresql.org/).
 *
 * @group Persistence
 * @extends PersistenceAdapter
 * @hideconstructor
 */
export class PostgresPersistenceAdapter extends PersistenceAdapter<PoolClient> {
  public readonly component = 'persistence';
  public readonly type = 'pg';

  public constructor(
    public readonly pool: Pool,
    public readonly clientConfig: ClientConfig,
  ) {
    super();
  }

  /**
   * Create a connection to a [PostgreSql](https://www.postgresql.org/) database
   * and resolve to an PersistenceAdapter that can be passed to the XJog
   * constructor.
   *
   * **Warning:** Don't run multiple `connect`s on same database at the same time,
   * since this will cause trouble with the schema migrations, be that journal or
   * regular database adapter. Let one resolve (e.g. `await`) before calling another.
   */
  static async connect(
    poolConfiguration: PoolConfig,
    // TODO resolve
    options: Partial<PostgreSQLPersistenceAdapterOptions> = {},
  ): Promise<PostgresPersistenceAdapter> {
    const pool = new Pool(poolConfiguration);

    const adapter = new PostgresPersistenceAdapter(pool, poolConfiguration);

    let migrationClient;
    try {
      migrationClient = await pool.connect();
      await migrationRunner({
        dbClient: migrationClient,
        migrationsTable: 'migrations_xjog',
        dir: path.join(__dirname, './migrations'),
        direction: 'up',
        log: (message) => adapter.trace({ in: 'connect', message }),
        // https://github.com/salsita/node-pg-migrate/issues/821,
        checkOrder: false,
        noLock: true,
      });
    } finally {
      if (migrationClient) {
        await migrationClient.release();
      }
    }

    return adapter;
  }

  public async disconnect(): Promise<void> {
    await this.pool.end();
  }

  /**
   * @group Transactions
   *
   * Executes the routine within a transaction. In case of an error,
   * rolls back. Otherwise, commits at the end. Inside, use the client,
   * if applicable.
   */
  public async withTransaction<ReturnType>(
    routine: (client: PoolClient) => Promise<ReturnType> | ReturnType,
    transactionConnectionForNesting?: PoolClient,
  ): Promise<ReturnType> {
    const client = await this.pool.connect();
    await client.query('BEGIN');

    try {
      const returnValue = await routine(client);
      await client.query('COMMIT');
      return returnValue;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async countAliveInstances(
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      'SELECT COUNT(*) AS "instanceCount" FROM "instances" WHERE "dying"=FALSE',
    );
    return Number(result.rows[0].instanceCount);
  }

  protected async insertInstance(
    id: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query(
      bind('INSERT INTO "instances" ("instanceId") VALUES (:id)', { id }),
    );
  }

  protected async deleteInstance(
    id: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    // TODO re-enable or make a cleanup with some lookbehind period
    // await connection.query('DELETE FROM instances WHERE "instanceId"=$1', [id]);
  }

  protected async markAllInstancesDying(
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query('UPDATE "instances" SET "dying"=TRUE');
  }

  protected async markAllChartsPaused(
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query('UPDATE "charts" SET "paused"=TRUE');
  }

  protected async countPausedCharts(
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      'SELECT COUNT(*) AS "chartCount" FROM "charts" WHERE "paused"=TRUE',
    );
    return result.rows[0].chartCount;
  }

  protected async getPausedChartIds(
    connection: Pool | PoolClient = this.pool,
  ): Promise<ChartReference[]> {
    const result = await connection.query(
      'SELECT "machineId", "chartId" FROM "charts" WHERE "paused"=TRUE',
    );

    return result.rows;
  }

  protected async getPausedChartWithNoOngoingActivitiesIds(
    connection: Pool | PoolClient = this.pool,
  ): Promise<ChartReference[]> {
    const result = await connection.query(
      'SELECT "machineId", "chartId" FROM "charts" ' +
        'WHERE "paused" = TRUE AND NOT EXISTS (' +
        '  SELECT * FROM "ongoingActivities" ' +
        '  WHERE "machineId" = "charts"."machineId"' +
        '    AND "chartId" = "charts"."chartId"' +
        ')',
    );

    return result.rows;
  }

  public async countOwnCharts(
    instanceId: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      bind(
        'SELECT COUNT(*) AS "chartCount" FROM "charts" ' +
          'WHERE "ownerId" = :instanceId',
        { instanceId },
      ),
    );
    return Number(result.rows[0].chartCount);
  }

  protected async deleteOngoingActivitiesForPausedCharts(
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      'DELETE FROM "ongoingActivities" WHERE NOT EXISTS (' +
        '  SELECT * FROM "charts" WHERE ' +
        '    "machineId" = "ongoingActivities"."machineId" AND' +
        '    "chartId" = "ongoingActivities"."chartId" AND' +
        '    "paused" = TRUE' +
        ')',
    );

    return result.rowCount;
  }

  protected async changeOwnerAndResumePausedCharts(
    id: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query(
      bind(
        'UPDATE "charts" ' +
          'SET "paused" = FALSE, "ownerId" = :id ' +
          'WHERE "paused" = TRUE',
        { id },
      ),
    );
  }

  // TODO use row id:s instead, can use IN, faster; also do in batches
  protected async changeOwnerAndResumeCharts(
    instanceId: string,
    refs: ChartReference[],
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    for (const ref of refs) {
      await connection.query(
        bind(
          'UPDATE "charts" ' +
            'SET "paused" = FALSE, "ownerId" = :instanceId ' +
            'WHERE "machineId" = :machineId AND "chartId" = :chartId ',
          {
            instanceId,
            machineId: ref.machineId,
            chartId: ref.chartId,
          },
        ),
      );
    }
  }

  // TODO use listening instead, slicker
  public onDeathNote(
    instanceId: string,
    callback: () => void,
    connection: Pool | PoolClient = this.pool,
  ): () => void {
    let cancelled = false;

    let timer: NodeJS.Timer | null = setInterval(async () => {
      if (cancelled) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        return;
      }

      const result = await connection.query(
        bind(
          'SELECT COUNT(*) as "dying" FROM "instances" ' +
            'WHERE "instanceId" = :instanceId AND "dying" = TRUE',
          { instanceId },
        ),
      );

      const dying = Number(result.rows[0].dying) > 0;

      if (dying) {
        cancelled = true;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        if (!cancelled) {
          callback();
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }

  protected async insertChart<
    TContext,
    TEvent extends EventObject,
    TStateSchema extends State<any>,
    TTypeState extends Typestate<any>,
  >(
    instanceId: string,
    ref: ChartReference,
    parentRef: ChartReference | null,
    state: State<TContext, TEvent, TStateSchema, TTypeState>,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query(
      bind(
        'INSERT INTO charts ' +
          '(' +
          '  "ownerId", "machineId", "chartId", ' +
          '  "parentMachineId", "parentChartId", "state"' +
          ') ' +
          'VALUES (' +
          '  :instanceId, :machineId, :chartId, ' +
          '  :parentMachineId, :parentChartId, :state ' +
          ')',
        {
          instanceId,
          machineId: ref.machineId,
          chartId: ref.chartId,
          parentMachineId: parentRef?.machineId ?? null,
          parentChartId: parentRef?.chartId ?? null,
          state: Buffer.from(JSON.stringify(state)),
        },
      ),
    );
  }

  protected async readChart<TContext, TEvent extends EventObject>(
    ref: ChartReference,
    connection: Pool | PoolClient = this.pool,
  ): Promise<PersistedChart<TContext, TEvent> | null> {
    const result = await connection.query<PostgreSQLChartRow>(
      bind(
        'SELECT * FROM "charts" ' +
          'WHERE "machineId" = :machineId AND "chartId" = :chartId ',
        { machineId: ref.machineId, chartId: ref.chartId },
      ),
    );

    if (!result.rowCount) {
      return null;
    }

    return PostgresPersistenceAdapter.parseSqlChartRow<TContext, TEvent>(
      result.rows[0],
    );
  }

  protected async updateChartState<TContext, TEvent extends EventObject>(
    ref: ChartReference,
    state: State<TContext, TEvent, StateSchema<TContext>, Typestate<TContext>>,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query(
      bind(
        'UPDATE "charts" SET "state" = :state ' +
          'WHERE "machineId" = :machineId AND "chartId" = :chartId',
        {
          machineId: ref.machineId,
          chartId: ref.chartId,
          state: Buffer.from(JSON.stringify(state)),
        },
      ),
    );
  }

  public async destroyChart(
    ref: ChartReference,
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.trace({ cid, in: 'destroyChart', ref, ...args });

    {
      trace({ message: 'Removing chart from the database' });
      const deletedRecords = await this.deleteChart(ref);

      if (deletedRecords < 1) {
        trace({
          level: 'warning',
          message: 'Chart not found in the database',
        });
        return;
      } else if (deletedRecords === 1) {
        trace({ message: 'Removed chart from the database' });
      } else {
        trace({
          level: 'warning',
          message: 'Removed multiple charts from the database',
          deletedRecords,
        });
      }
    }

    {
      trace({ message: 'Removing deferred events from the database' });
      const deletedRecords = await this.deleteAllDeferredEvents(ref);
      trace({
        message: 'Removed deferred events from the database',
        deletedRecords,
      });
    }

    {
      trace({ message: 'Removing external identifiers from the database' });
      const deletedRecords = this.deleteExternalIdentifiers(ref);
      trace({
        message: 'Removed external identifiers from the database',
        deletedRecords,
      });
    }

    trace({ message: 'Done' });
  }

  /**
   * @returns Number of deleted records
   */
  protected async deleteChart(
    ref: ChartReference,
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      bind(
        'DELETE FROM "charts" WHERE "machineId" = :machineId AND "chartId" = :chartId',
        {
          machineId: ref.machineId,
          chartId: ref.chartId,
        },
      ),
    );
    return result.rowCount;
  }

  public async isActivityRegistered(
    ref: ChartReference,
    activityId: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<boolean> {
    const result = await connection.query(
      bind(
        'SELECT 1 FROM "ongoingActivities" ' +
          'WHERE "machineId" = :machineId AND "chartId" = :chartId AND "activityId" = :activityId',
        {
          machineId: ref.machineId,
          chartId: ref.chartId,
          activityId,
        },
      ),
    );

    return result.rows.length > 0;
  }

  public async registerActivity(
    ref: ChartReference,
    activityId: string,
    cid: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    const response = await connection.query(
      bind(
        'INSERT INTO "ongoingActivities" ' +
          '  ("machineId", "chartId", "activityId") ' +
          'VALUES (:machineId, :chartId, :activityId) ' +
          'ON CONFLICT ("machineId", "chartId", "activityId") ' +
          '  DO NOTHING ',
        { machineId: ref.machineId, chartId: ref.chartId, activityId },
      ),
    );
  }

  public async unregisterActivity(
    ref: ChartReference,
    activityId: string,
    cid: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    const response = await connection.query(
      bind(
        'DELETE FROM "ongoingActivities" ' +
          'WHERE "machineId" = :machineId AND "chartId" = :chartId AND "activityId" = :activityId',
        { machineId: ref.machineId, chartId: ref.chartId, activityId },
      ),
    );
  }

  /**
   * @returns Number of deleted records
   */
  protected async deleteAllDeferredEvents(
    ref: ChartReference,
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      bind(
        'DELETE FROM "deferredEvents" WHERE "machineId" = :machineId AND "chartId" = :chartId',
        { machineId: ref.machineId, chartId: ref.chartId },
      ),
    );
    return result.rowCount;
  }

  public async getExternalIdentifiers(
    key: string,
    ref: ChartReference,
    connection: Pool | PoolClient = this.pool,
  ): Promise<string[]> {
    const result = await connection.query<{ value: string }>(
      bind(
        'SELECT "value" FROM "externalId" ' +
          'WHERE "machineId" = :machineId AND "chartId" = :chartId AND "key" = :key',
        { machineId: ref.machineId, chartId: ref.chartId, key },
      ),
    );
    return result.rows.map((row) => row.value);
  }

  public async getChartByExternalIdentifier(
    key: string,
    value: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<ChartReference | null> {
    const result = await connection.query<ChartReference>(
      'SELECT "machineId", "chartId" FROM "externalId" ' +
        'WHERE "key"=$1 AND "value"=$2 FOR SHARE',
      [key, value],
    );
    return result.rows[0] ?? null;
  }

  public async registerExternalId(
    ref: ChartReference,
    key: string,
    value: string,
    cid: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query(
      'INSERT INTO "externalId" ' +
        '  ("machineId", "chartId", "key", "value") ' +
        'VALUES ($1, $2, $3, $)',
      [ref.machineId, ref.chartId, key, value],
    );
  }

  public async dropExternalId(
    key: string,
    value: string,
    cid: string,
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      'DELETE FROM "externalId" WHERE "key"=$1 AND "value"=$2',
      [key, value],
    );
    return result.rowCount;
  }

  /**
   * @returns Number of deleted records
   */
  protected async deleteExternalIdentifiers(
    ref: ChartReference,
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      'DELETE FROM "externalId" WHERE "machineId"=$1 AND "chartId"=$2',
      [ref.machineId, ref.chartId],
    );
    return result.rowCount;
  }

  /** Corresponds to {@link PostgreSQLDeferredEventRow} */
  private readonly deferredEventSelectFields =
    '  "id", "machineId", "chartId", "lock", ' +
    '  "eventId", "eventTo", "event", "delay", ' +
    '  extract(epoch from "timestamp") * 1000 as "timestamp", ' +
    '  extract(epoch from "due") * 1000 as "due" ';

  protected async readDeferredEventRow(
    id: number,
    connection: Pool | PoolClient = this.pool,
  ): Promise<PersistedDeferredEvent | null> {
    const result = await connection.query<PostgreSQLDeferredEventRow>(
      'SELECT ' +
        this.deferredEventSelectFields +
        'FROM "deferredEvents" ' +
        'WHERE "id"=$1 ' +
        'FOR SHARE',
      [id],
    );

    if (!result.rowCount) {
      return null;
    }

    return PostgresPersistenceAdapter.parseSqlDeferredEventRow(result.rows[0]);
  }

  /**
   * Read a batch of deferred events and mark them taken
   * @param instanceId
   * @param lookAhead
   * @param batchSize
   * @param connection
   * @protected
   */
  protected async readDeferredEventRowBatch(
    instanceId: string,
    lookAhead: number,
    batchSize: number,
    connection: Pool | PoolClient = this.pool,
  ): Promise<PersistedDeferredEvent[]> {
    const result = await connection.query(
      'WITH updated AS ( ' +
        '  UPDATE "deferredEvents" ' +
        '  SET "lock"=$3 ' +
        '  WHERE "id" IN ' +
        '  (' +
        '    SELECT "id" FROM "deferredEvents" ' +
        '    WHERE "due"<(transaction_timestamp() + make_interval(secs => $1::bigint / 1000)) ' +
        '      AND "lock" IS NULL ' +
        '    ORDER BY "due" ASC, "id" ASC ' +
        '    LIMIT $2::bigint' +
        '  ) ' +
        '  RETURNING * ' +
        ') ' +
        'SELECT ' +
        this.deferredEventSelectFields +
        'FROM updated ' +
        'ORDER BY "due" ASC, "id" ASC',
      [lookAhead, batchSize, instanceId],
    );

    return result.rows.map(PostgresPersistenceAdapter.parseSqlDeferredEventRow);
  }

  // protected async markDeferredEventBatchForProcessing(
  //   instanceId: string,
  //   lookAhead: number,
  //   batchSize: number,
  //   connection: Pool | PoolClient = this.pool,
  // ): Promise<void> {
  //   await connection.query(
  //     'UPDATE "deferredEvents" ' +
  //       'SET "lock"=$3 WHERE "id" IN ' +
  //       '(' +
  //       '  SELECT "id" FROM "deferredEvents" ' +
  //       '  WHERE "due"<(transaction_timestamp() + make_interval(secs => $1::bigint / 1000)) ' +
  //       '    AND "lock" IS NULL ' +
  //       '  ORDER BY "due" ASC, "id" DESC ' +
  //       '  LIMIT $2::bigint' +
  //       ')',
  //     [lookAhead, batchSize, instanceId],
  //   );
  // }

  public async releaseDeferredEvent(
    ref: ChartReference,
    eventId: string | number,
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query(
      'UPDATE "deferredEvents" SET "lock"=NULL ' +
        'WHERE "machineId"=$1 AND "chartId"=$2 AND "eventId"=$3',
      [ref.machineId, ref.chartId, JSON.stringify(eventId)],
    );
  }

  protected async unmarkAllDeferredEventsForProcessing(
    connection: Pool | PoolClient = this.pool,
  ): Promise<void> {
    await connection.query('UPDATE "deferredEvents" SET "lock"=NULL');
  }

  protected async insertDeferredEvent(
    PersistedDeferredEvent: Omit<
      PersistedDeferredEvent,
      'id' | 'due' | 'timestamp'
    >,
    connection: Pool | PoolClient = this.pool,
  ): Promise<PersistedDeferredEvent | null> {
    let toFieldStringRepresentation = null;

    if (PersistedDeferredEvent.eventTo) {
      if (
        typeof PersistedDeferredEvent.eventTo === 'string' ||
        typeof PersistedDeferredEvent.eventTo === 'number'
      ) {
        toFieldStringRepresentation = PersistedDeferredEvent.eventTo;
      } else {
        const chartIdentifierFromToField = ChartIdentifier.from(
          PersistedDeferredEvent.eventTo,
        );
        if (chartIdentifierFromToField) {
          toFieldStringRepresentation =
            chartIdentifierFromToField.uri.toString();
        } else if (
          typeof PersistedDeferredEvent.eventTo === 'object' &&
          'id' in PersistedDeferredEvent.eventTo &&
          PersistedDeferredEvent.eventTo.id
        ) {
          toFieldStringRepresentation = PersistedDeferredEvent.eventTo.id;
        }
      }
    }

    const result = await connection.query<PostgreSQLDeferredEventRow>(
      bind(
        'INSERT INTO "deferredEvents" (' +
          '  "machineId", "chartId", ' +
          '  "eventId", "eventTo", "event", ' +
          '  "timestamp", "delay", ' +
          '  "due" ' +
          ') VALUES (' +
          '  :machineId, :chartId, ' +
          '  :eventId, :eventTo, :event, ' +
          '  transaction_timestamp(), :delay::bigint, ' +
          '  transaction_timestamp() + make_interval(secs => :delay::bigint / 1000)' +
          ') ' +
          'RETURNING ' +
          this.deferredEventSelectFields,
        {
          machineId: PersistedDeferredEvent.ref.machineId,
          chartId: PersistedDeferredEvent.ref.chartId,

          eventId: JSON.stringify(PersistedDeferredEvent.eventId),
          eventTo: JSON.stringify(toFieldStringRepresentation),
          event: JSON.stringify(PersistedDeferredEvent.event),

          delay: Math.ceil(PersistedDeferredEvent.delay),
        },
      ),
    );

    if (!result.rowCount) {
      return null;
    }

    return PostgresPersistenceAdapter.parseSqlDeferredEventRow(result.rows[0]);
  }

  protected async deleteDeferredEvent(
    id: number,
    connection: Pool | PoolClient = this.pool,
  ): Promise<number> {
    const result = await connection.query(
      'DELETE FROM "deferredEvents" WHERE "id"=$1 ',
      [id],
    );

    return result.rowCount;
  }

  private static parseSqlChartRow<TContext, TEvent extends EventObject>(
    row: PostgreSQLChartRow,
  ): PersistedChart<TContext, TEvent> {
    return {
      timestamp: Number(row.timestamp),

      ownerId: row.ownerId,
      ref: {
        machineId: row.machineId,
        chartId: row.chartId,
      },
      parentRef: row.parentChartId
        ? {
            machineId: row.parentMachineId,
            chartId: row.parentChartId,
          }
        : null,

      state: JSON.parse(row.state.toString()) as StateConfig<TContext, TEvent>,

      paused: row.paused,
    };
  }

  private static parseSqlDeferredEventRow(
    row: PostgreSQLDeferredEventRow,
  ): PersistedDeferredEvent {
    return {
      id: row.id,
      timestamp: Number(row.timestamp),
      ref: {
        machineId: row.machineId,
        chartId: row.chartId,
      },
      eventId: JSON.parse(row.eventId),
      eventTo: JSON.parse(row.eventTo),
      event: JSON.parse(row.event),
      delay: row.delay,
      due: row.due,
      lock: row.lock,
    };
  }
}
