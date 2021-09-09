/**
 * Full state entry row directly from the SQL query
 */
export type PostgresFullStateRow = {
  id: number;
  created: number;
  timestamp: number;

  ownerId: string;
  machineId: string;
  chartId: string;
  parentMachineId: string;
  parentChartId: string;

  event: Buffer | null;
  state: Buffer | null;
  context: Buffer | null;
};
