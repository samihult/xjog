import path from 'path';
import { ChartReference } from '@samihult/xjog-util';
import { Client, PoolConfig } from 'pg';
import migrationRunner from 'node-pg-migrate';
import createSubscriber from 'pg-listen';
import bind from 'pg-bind';

import {
  FullStateEntry,
  FullStateQuery,
  JournalEntry,
  JournalEntryAutoFields,
  JournalEntryInsertFields,
  JournalPersistenceAdapter,
  JournalQuery,
} from '@samihult/xjog-journal-persistence';

import { PostgresJournalRow } from './PostgresJournalRow';
import { PostgresFullStateRow } from './PostgresFullStateRow';

/**
 * Options for instantiating {@link PostgresJournalPersistenceAdapter}.
 */
export type PostgresJournalPersistenceAdapterOptions = {
  keyFrameInterval?: number;
};

/**
 * Use the static method `connect` to instantiate.
 * @hideconstructor
 */
export class PostgresJournalPersistenceAdapter extends JournalPersistenceAdapter {
  public readonly component = 'journal/persistence';
  public readonly type = 'pg';

  private readonly stopObservingNewJournalEntries: Promise<() => Promise<void>>;

  public constructor(
    private readonly listenerConfig: PoolConfig,
    private readonly subscriptionConnection: Client,
    private readonly readConnection: Client,
    private readonly writeConnection: Client,
    private readonly updateConnection: Client,
    private options: PostgresJournalPersistenceAdapterOptions,
  ) {
    super();

    subscriptionConnection.on('error', (err) =>
      this.error('Subscription connection emitted error', { err }),
    );
    readConnection.on('error', (err) =>
      this.error('Read connection emitted error', { err }),
    );
    writeConnection.on('error', (err) =>
      this.error('Write connection emitted error', { err }),
    );
    updateConnection.on('error', (err) =>
      this.error('Update connection emitted error', { err }),
    );

    this.stopObservingNewJournalEntries =
      this.startObservingNewJournalEntries();
  }

  /**
   * Create a connection to a [PostgreSql](https://www.postgresql.org/) database
   * and resolve to a JournalPersistenceAdapter that can be passed to the XJog
   * constructor.
   */
  static async connect(
    poolConfiguration: PoolConfig,
    // TODO resolve
    options: Partial<PostgresJournalPersistenceAdapterOptions> = {},
  ): Promise<PostgresJournalPersistenceAdapter> {
    const subscriptionConnection = new Client(poolConfiguration);
    const readConnection = new Client(poolConfiguration);
    const writeConnection = new Client(poolConfiguration);
    const updateConnection = new Client(poolConfiguration);

    const adapter = new PostgresJournalPersistenceAdapter(
      poolConfiguration,
      subscriptionConnection,
      readConnection,
      writeConnection,
      updateConnection,
      options,
    );

    await subscriptionConnection.connect();
    await readConnection.connect();
    await writeConnection.connect();
    await updateConnection.connect();

    // TODO resolve separately
    options.keyFrameInterval ??= 100;

    const migrationClient = new Client(poolConfiguration);
    try {
      await migrationClient.connect();
      await migrationRunner({
        dbClient: migrationClient,
        migrationsTable: 'migrations_journal',
        dir: path.join(__dirname, './migrations'),
        direction: 'up',
        log: (message) => adapter.trace({ in: 'connect', message }),
        // https://github.com/salsita/node-pg-migrate/issues/821
        checkOrder: false,
        noLock: true,
      });
    } finally {
      if (migrationClient) {
        await migrationClient.end();
      }
    }

    return adapter;
  }

  public async disconnect(): Promise<void> {
    await (
      await this.stopObservingNewJournalEntries
    )();

    await this.subscriptionConnection.end();
    await this.updateConnection.end();
    await this.writeConnection.end();
    await this.readConnection.end();
  }

  protected async insertEntry(
    entry: JournalEntryInsertFields,
  ): Promise<JournalEntryAutoFields> {
    const query = bind(
      'INSERT INTO "journalEntries" ' +
        '(' +
        '  "machineId", "chartId", "event",  ' +
        '  "state", "context", "stateDelta", "contextDelta" ' +
        ') ' +
        'VALUES (' +
        '  :machineId, :chartId, :event, ' +
        '  NULL, NULL, :stateDelta, :contextDelta ' +
        ') ' +
        'RETURNING ' +
        '  "id", extract(epoch from "timestamp") * 1000 as "timestamp" ',
      {
        machineId: entry.ref.machineId,
        chartId: entry.ref.chartId,
        event: entry.event ? Buffer.from(JSON.stringify(entry.event)) : null,
        stateDelta: Buffer.from(JSON.stringify(entry.stateDelta)),
        contextDelta: Buffer.from(JSON.stringify(entry.contextDelta)),
      },
    );

    const result = await this.writeConnection.query(query);

    if (!result.rowCount) {
      throw new Error('Failed to write journal entry');
    }

    return {
      id: result.rows[0].id,
      timestamp: Number(result.rows[0].timestamp),
    };
  }

  protected async updateFullState(entry: FullStateEntry): Promise<void> {
    const query = bind(
      'INSERT INTO "fullJournalStates" ' +
        '( ' +
        '  "id", "created", "timestamp", ' +
        '  "ownerId", "machineId", "chartId", ' +
        '  "parentMachineId", "parentChartId", ' +
        '  "event", "state", "context" ' +
        ') ' +
        'VALUES (' +
        '  :id, to_timestamp(:timestamp::decimal / 1000), ' +
        '  to_timestamp(:timestamp::decimal / 1000), ' +
        '  :ownerId, :machineId, :chartId, ' +
        '  :parentMachineId, :parentChartId, ' +
        '  :event, :state, :context ' +
        ') ON CONFLICT (' +
        '  "machineId", "chartId" ' +
        ') DO UPDATE SET ' +
        '  "id" = :id, "timestamp" = to_timestamp(:timestamp::decimal / 1000), ' +
        '  "event" = :event, "state" = :state, "context" = :context ' +
        'WHERE "fullJournalStates"."id" < :id ',
      {
        id: entry.id,
        timestamp: entry.timestamp,
        ownerId: entry.ownerId,
        machineId: entry.ref.machineId,
        chartId: entry.ref.chartId,
        parentMachineId: entry.parentRef?.machineId ?? null,
        parentChartId: entry.parentRef?.chartId ?? null,
        event: entry.event ? Buffer.from(JSON.stringify(entry.event)) : null,
        state: entry.state ? Buffer.from(JSON.stringify(entry.state)) : null,
        context: entry.context
          ? Buffer.from(JSON.stringify(entry.context))
          : null,
      },
    );

    const result = await this.writeConnection.query(query);

    if (!result.rowCount) {
      throw new Error('Failed to write journal full entry');
    }

    return result.rows[0];
  }

  protected async emitJournalEntryNotification(
    id: number,
    ref: ChartReference,
  ): Promise<void> {
    const payload = JSON.stringify({
      id,
      machineId: ref.machineId,
      chartId: ref.chartId,
    });

    await this.updateConnection.query(
      bind("SELECT pg_notify('new-journal-entry', :payload::text)", {
        payload,
      }),
    );
  }

  /** These SQL fields correspond to {@link PostgresJournalRow} */
  private readonly journalEntrySqlSelectFields =
    '  "id", extract(epoch from "timestamp") * 1000 as "timestamp", ' +
    '  "machineId", "chartId", "event", ' +
    '  "state", "stateDelta", "context", "contextDelta" ';

  public async readEntry(id: number): Promise<JournalEntry | null> {
    const result = await this.readConnection.query<PostgresJournalRow>(
      bind(
        'SELECT ' +
          this.journalEntrySqlSelectFields +
          'FROM "journalEntries" WHERE "id"=:id::bigint',
        { id },
      ),
    );

    if (!result.rowCount) {
      return null;
    }

    return PostgresJournalPersistenceAdapter.parseSqlJournalRow(result.rows[0]);
  }

  public async queryEntries(query: JournalQuery): Promise<JournalEntry[]> {
    let result;

    if (Array.isArray(query)) {
      if (!query.length) {
        return [];
      }

      result = await this.readConnection.query<PostgresJournalRow>(
        'SELECT ' +
          this.journalEntrySqlSelectFields +
          'FROM "journalEntries" ' +
          'JOIN (VALUES ' +
          query
            .map(
              ({ machineId, chartId }) =>
                `(${this.readConnection.escapeLiteral(machineId)}, ` +
                `${this.readConnection.escapeLiteral(chartId)})`,
            )
            .join(', ') +
          ') ' +
          '  AS "queryValues" ("queryMachineId", "queryChartId") ' +
          'ON "machineId" = "queryMachineId" AND "chartId" = "queryChartId" ',
      );
    } else {
      result = await this.readConnection.query<PostgresJournalRow>(
        bind(
          'SELECT ' +
            this.journalEntrySqlSelectFields +
            'FROM "journalEntries" ' +
            'WHERE TRUE ' +
            (query.ref !== undefined
              ? '  AND "machineId" = :machineId AND "chartId" = :chartId '
              : '') +
            (query.afterId !== undefined
              ? '  AND "id" > :afterId::bigint '
              : '') +
            (query.afterAndIncludingId !== undefined
              ? '  AND "id" >= :afterAndIncludingId::bigint '
              : '') +
            (query.beforeId !== undefined
              ? '  AND "id" < :beforeId::bigint '
              : '') +
            (query.beforeAndIncludingId !== undefined
              ? '  AND "id" <= :beforeAndIncludingId::bigint '
              : '') +
            (query.updatedAfterAndIncluding !== undefined
              ? '  AND "timestamp" >= to_timestamp(:updatedAfterAndIncluding::decimal / 1000) '
              : '') +
            (query.updatedBeforeAndIncluding !== undefined
              ? '  AND "timestamp" <= to_timestamp(:updatedBeforeAndIncluding::decimal / 1000) '
              : '') +
            'ORDER BY "id" ' +
            (query.order ?? 'ASC') +
            (query.offset !== undefined ? '  OFFSET :offset' : '') +
            (query.limit !== undefined ? '  LIMIT :limit' : ''),
          {
            machineId: query.ref?.machineId,
            chartId: query.ref?.chartId,
            afterId: query.afterId,
            afterAndIncludingId: query.afterAndIncludingId,
            beforeId: query.beforeId,
            beforeAndIncludingId: query.beforeAndIncludingId,
            updatedAfterAndIncluding: query.updatedAfterAndIncluding,
            updatedBeforeAndIncluding: query.updatedBeforeAndIncluding,
            offset: query.offset,
            limit: query.limit,
          },
        ),
      );
    }

    return result.rows.map(
      PostgresJournalPersistenceAdapter.parseSqlJournalRow,
    );
  }

  private async startObservingNewJournalEntries(): Promise<
    () => Promise<void>
  > {
    const startTime = await this.getCurrentTime();

    let journalEntryIdPointer = 0;
    let fullStateEntryIdPointer = 0;

    const channel = 'new-journal-entry';
    const journalSubscriber = createSubscriber(this.listenerConfig);

    const yieldJournalEntries = (journalEntries: JournalEntry[]) => {
      for (const journalEntry of journalEntries) {
        if (journalEntry.id < journalEntryIdPointer) {
          return;
        }
        journalEntryIdPointer = journalEntry.id;
        this.newJournalEntriesSubject.next(journalEntry);
      }
    };

    const yieldFullStateEntries = (fullStateEntries: FullStateEntry[]) => {
      for (const fullStateEntry of fullStateEntries) {
        if (fullStateEntry.id < fullStateEntryIdPointer) {
          return;
        }
        fullStateEntryIdPointer = fullStateEntry.id;
        this.newFullStateEntriesSubject.next(fullStateEntry);
      }
    };

    // Received a notification of a new journal entry
    journalSubscriber.notifications.on(channel, async () => {
      this.queryEntries({
        afterId: journalEntryIdPointer,
        updatedAfterAndIncluding: startTime,
        order: 'DESC',
      }).then((journalEntries: JournalEntry[]) => {
        if (journalEntries.length) {
          yieldJournalEntries(journalEntries);
        }
      });

      this.queryFullStates({
        afterId: fullStateEntryIdPointer,
        updatedAfterAndIncluding: startTime,
        order: 'DESC',
      }).then((fullStateEntries: FullStateEntry[]) => {
        if (fullStateEntries.length) {
          yieldFullStateEntries(fullStateEntries);
        }
      });
    });

    journalSubscriber.events.on('error', (error) => {
      this.newJournalEntriesSubject.error(error);
      this.newFullStateEntriesSubject.error(error);
    });

    journalSubscriber.connect().then(() => journalSubscriber.listenTo(channel));

    return async () => {
      await journalSubscriber.close();
    };
  }

  /** These SQL fields correspond to {@link PostgresFullStateRow} */
  private readonly fullStateEntrySqlSelectFields =
    '  "id", extract(epoch from "created") * 1000 as "created", ' +
    '  extract(epoch from "timestamp") * 1000 as "timestamp", ' +
    '  "machineId", "chartId", "parentMachineId", "parentChartId", ' +
    '  "event", "state", "context" ';

  public async readFullState(
    ref: ChartReference,
  ): Promise<FullStateEntry | null> {
    const result = await this.readConnection.query<PostgresFullStateRow>(
      bind(
        'SELECT ' +
          this.fullStateEntrySqlSelectFields +
          'FROM "fullJournalStates" ' +
          'WHERE "machineId" = :machineId AND "chartId" = :chartId ',
        {
          machineId: ref.machineId,
          chartId: ref.chartId,
        },
      ),
    );

    if (!result.rowCount) {
      return null;
    }

    return PostgresJournalPersistenceAdapter.parseSqlFullStateRow(
      result.rows[0],
    );
  }

  public async queryFullStates(
    query: FullStateQuery,
  ): Promise<FullStateEntry[]> {
    let result;

    if (Array.isArray(query)) {
      if (!query.length) {
        return [];
      }

      result = await this.readConnection.query<PostgresFullStateRow>(
        'SELECT ' +
          this.fullStateEntrySqlSelectFields +
          'FROM "fullJournalStates" ' +
          'JOIN (VALUES ' +
          query
            .map(
              ({ machineId, chartId }) =>
                `(${this.readConnection.escapeLiteral(machineId)}, ` +
                `${this.readConnection.escapeLiteral(chartId)})`,
            )
            .join(', ') +
          ') ' +
          '  AS "queryValues" ("queryMachineId", "queryChartId") ' +
          'ON "machineId" = "queryMachineId" AND "chartId" = "queryChartId" ',
      );
    } else {
      result = await this.readConnection.query<PostgresFullStateRow>(
        bind(
          'SELECT ' +
            this.fullStateEntrySqlSelectFields +
            'FROM "fullJournalStates" ' +
            'WHERE TRUE ' +
            (query.ref !== undefined && query.machineId === undefined
              ? '  AND "machineId" = :machineId AND "chartId" = :chartId '
              : '') +
            (query.parentRef !== undefined
              ? '  AND "parentMachineId" = :parentMachineId AND "parentChartId" = :parentChartId '
              : '') +
            // In case of both machineId and ref, ref takes precedence
            (query.machineId !== undefined && query.ref === undefined
              ? '  AND "machineId" = :machineId '
              : '') +
            (query.afterId !== undefined
              ? '  AND "id" > :afterId::bigint '
              : '') +
            (query.afterAndIncludingId !== undefined
              ? '  AND "id" >= :afterAndIncludingId::bigint '
              : '') +
            (query.beforeId !== undefined
              ? '  AND "id" < :beforeId::bigint '
              : '') +
            (query.beforeAndIncludingId !== undefined
              ? '  AND "id" <= :beforeAndIncludingId::bigint '
              : '') +
            (query.createdAfterAndIncluding !== undefined
              ? '  AND "created" >= to_timestamp(:createdAfterAndIncluding::decimal / 1000) '
              : '') +
            (query.createdBeforeAndIncluding !== undefined
              ? '  AND "created" <= to_timestamp(:createdBeforeAndIncluding::decimal / 1000) '
              : '') +
            (query.updatedAfterAndIncluding !== undefined
              ? '  AND "timestamp" >= to_timestamp(:updatedAfterAndIncluding::decimal / 1000)  '
              : '') +
            (query.updatedBeforeAndIncluding !== undefined
              ? '  AND "timestamp" <= to_timestamp(:updatedBeforeAndIncluding::decimal / 1000) '
              : '') +
            'ORDER BY "id" ' +
            (query.order ?? 'ASC') +
            (query.offset !== undefined ? '  OFFSET :offset' : '') +
            (query.limit !== undefined ? '  LIMIT :limit' : ''),
          {
            machineId: query.ref?.machineId ?? query.machineId,
            chartId: query.ref?.chartId,
            parentMachineId: query.parentRef?.machineId,
            parentChartId: query.parentRef?.chartId,
            afterId: query.afterId,
            afterAndIncludingId: query.afterAndIncludingId,
            beforeId: query.beforeId,
            beforeAndIncludingId: query.beforeAndIncludingId,
            createdAfterAndIncluding: query.createdAfterAndIncluding,
            createdBeforeAndIncluding: query.createdBeforeAndIncluding,
            updatedAfterAndIncluding: query.updatedAfterAndIncluding,
            updatedBeforeAndIncluding: query.updatedBeforeAndIncluding,
            offset: query.offset,
            limit: query.limit,
          },
        ),
      );
    }

    return result.rows.map(
      PostgresJournalPersistenceAdapter.parseSqlFullStateRow,
    );
  }

  /**
   * @returns Number of deleted records
   */
  public async deleteByChart(ref: ChartReference): Promise<number> {
    const fullStateResult = await this.updateConnection.query(
      bind(
        'DELETE FROM "fullJournalStates" ' +
          'WHERE "machineId"=:machineId AND "chartId"=:chartId',
        {
          machineId: ref.machineId,
          chartId: ref.chartId,
        },
      ),
    );

    const journalEntryResult = await this.updateConnection.query(
      bind(
        'DELETE FROM "journalEntries" ' +
          'WHERE "machineId"=:machineId AND "chartId"=:chartId',
        {
          machineId: ref.machineId,
          chartId: ref.chartId,
        },
      ),
    );

    return fullStateResult.rowCount + journalEntryResult.rowCount;
  }

  public async getCurrentTime(): Promise<number> {
    const result = await this.readConnection.query<{ time: number }>(
      'SELECT extract(epoch from transaction_timestamp()) * 1000 AS "time"',
    );

    if (!result.rowCount) {
      throw new Error('Failed to read current time from database');
    }

    return Number(result.rows[0].time);
  }

  static parseSqlJournalRow(row: PostgresJournalRow): JournalEntry {
    return {
      id: Number(row.id),
      timestamp: Number(row.timestamp),

      ref: {
        machineId: row.machineId,
        chartId: row.chartId,
      },

      event: JSON.parse(String(row.event)),

      state: row.state ? JSON.parse(String(row.state)) : null,
      context: row.context ? JSON.parse(String(row.context)) : null,

      stateDelta: JSON.parse(String(row.stateDelta)),
      contextDelta: JSON.parse(String(row.contextDelta)),
    };
  }

  static parseSqlFullStateRow(row: PostgresFullStateRow): FullStateEntry {
    return {
      id: Number(row.id),
      created: Number(row.created),
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

      event: JSON.parse(String(row.event)),
      state: row.state ? JSON.parse(String(row.state)) : null,
      context: row.context ? JSON.parse(String(row.context)) : null,
    };
  }
}
