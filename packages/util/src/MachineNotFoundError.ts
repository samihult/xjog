export class MachineNotFoundError extends Error {
  constructor(machineId: string, message?: string) {
    super(`MachineId: ${machineId}${message ? ` - ${message}` : ''}`);
    this.name = 'MachineNotFoundError';
  }
}
