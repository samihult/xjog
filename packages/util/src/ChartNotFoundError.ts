import { ChartReference } from './ChartReference';

export class ChartNotFoundError extends Error {
  constructor(ref: ChartReference, message?: string) {
    super(`MachineId: ${ref.machineId}, chartId: ${ref.chartId}${message ? ` - ${message}` : ''}`);
    this.name = 'ChartNotFoundError';
  }
}
