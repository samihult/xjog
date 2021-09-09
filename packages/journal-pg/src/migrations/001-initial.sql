--------------------------------------------------------------------------------
-- Up migration
--------------------------------------------------------------------------------

CREATE TABLE "journalEntries" (
  "id" SERIAL PRIMARY KEY,
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT transaction_timestamp(),

  "machineId" TEXT NOT NULL,
  "chartId" TEXT NOT NULL,

  -- Event that caused this transition, as serialized JSON
  "event" BYTEA,
  -- Full state as serialized JSON, but only mandatory for the first entry
  "state" BYTEA DEFAULT NULL,
  -- Context as serialized JSON,but only mandatory for the first entry
  "context" BYTEA DEFAULT NULL,

  -- Change set between this and previous entry, can be used for time travel
  "stateDelta" BYTEA NOT NULL,
  -- Change set between this and previous entry, can be used for time travel
  "contextDelta" BYTEA NOT NULL
);

CREATE INDEX "journalChartIndex" ON "journalEntries" ("machineId", "chartId");

CREATE TABLE "fullJournalStates" (
  "id" BIGINT,
  "created" TIMESTAMP WITH TIME ZONE NOT NULL,
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,

  "ownerId" TEXT,
  "machineId" TEXT NOT NULL,
  "chartId" TEXT NOT NULL,
  "parentMachineId" TEXT,
  "parentChartId" TEXT,

  -- Event that caused this transition, as serialized JSON
  "event" BYTEA DEFAULT NULL,

  -- Full state as serialized JSON, but only mandatory for the first entry
  "state" BYTEA DEFAULT NULL,
  -- Context as serialized JSON,but only mandatory for the first entry
  "context" BYTEA DEFAULT NULL,

  PRIMARY KEY("machineId", "chartId")
);

CREATE INDEX "fullJournalChartParentIndex"
  ON "fullJournalStates" ("parentMachineId", "parentChartId")
  WHERE "parentChartId" IS NOT NULL;

--------------------------------------------------------------------------------
-- Down migration
--------------------------------------------------------------------------------

DROP INDEX "fullJournalChartParentIndex";
DROP INDEX "journalChartIndex";

DROP TABLE "fullJournalStates";
DROP TABLE "journalEntries";
