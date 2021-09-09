--------------------------------------------------------------------------------
-- Up migration
--------------------------------------------------------------------------------

CREATE TABLE "digests" (
  "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT transaction_timestamp(),
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT transaction_timestamp(),

  "machineId" TEXT NOT NULL,
  "chartId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,

  PRIMARY KEY ("machineId", "chartId", "key")
);

--------------------------------------------------------------------------------
-- Down migration
--------------------------------------------------------------------------------

DROP TABLE "digests";
