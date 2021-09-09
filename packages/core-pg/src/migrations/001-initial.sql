--------------------------------------------------------------------------------
-- Up migration
--------------------------------------------------------------------------------

CREATE TABLE "instances" (
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT transaction_timestamp(),
  "instanceId" TEXT PRIMARY KEY,
  "dying" BOOLEAN DEFAULT false
);

CREATE TABLE "charts" (
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT transaction_timestamp(),

  -- instanceId of an instance
  "ownerId" TEXT,

  "machineId" TEXT NOT NULL,
  "chartId" TEXT NOT NULL,
  "parentMachineId" TEXT,
  "parentChartId" TEXT,

  -- Full state as serialized JSON
  "state" BYTEA NOT NULL,

  "paused" BOOLEAN NOT NULL DEFAULT false,

  PRIMARY KEY ("machineId", "chartId")
);

CREATE TABLE "deferredEvents" (
  "id" SERIAL PRIMARY KEY,

  "machineId" TEXT NOT NULL,
  "chartId" TEXT NOT NULL,

  -- Id serialized as JSON value (number or string)
  "eventId" TEXT NOT NULL,
  -- Possible destination serialized as JSON value
  "eventTo" TEXT,

  -- SCXML event as mapped by XState
  "event" TEXT NOT NULL,

  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT transaction_timestamp(),
  -- Corresponds to SendActionObject's field delay
  "delay" BIGINT NOT NULL,
  -- Calculated due time
  "due" TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Id of the instance who's processing this event, or NULL if none
  "lock" TEXT
);

CREATE INDEX "deferredEventChartIndex" ON "deferredEvents" ("machineId", "chartId");

CREATE TABLE "ongoingActivities" (
  "machineId" TEXT NOT NULL,
  "chartId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,

  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT transaction_timestamp(),

  PRIMARY KEY ("machineId", "chartId", "activityId")
);

CREATE INDEX "ongoingActivitiesChartIndex" ON "ongoingActivities" ("machineId", "chartId");

-- Unique external identifiers assigned to a chart
CREATE TABLE "externalId" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,

  "machineId" TEXT NOT NULL,
  "chartId" TEXT NOT NULL,

  PRIMARY KEY ("key", "value")
);

CREATE INDEX "externalIdKeyIndex" ON "externalId" ("key");
CREATE INDEX "externalIdChartIndex" ON "externalId" ("machineId", "chartId");

--------------------------------------------------------------------------------
-- Down migration
--------------------------------------------------------------------------------

DROP INDEX "externalIdKeyIndex";
DROP INDEX "externalIdChartIndex";
DROP INDEX "deferredEventChartIndex";

DROP TABLE "externalId";
DROP TABLE "deferredEvents";
DROP TABLE "charts";
DROP TABLE "instances";

