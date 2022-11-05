/**
 * Journal entry row directly from the SQL query
 */
export type PostgresJournalRow = {
  id: number;
  timestamp: number;
  machineId: string;
  chartId: string;
  event: Buffer | null;
  state: Buffer | null;
  stateDelta: Buffer;
  context: Buffer | null;
  contextDelta: Buffer;
  actions: Buffer | null;
};
