import { XJog } from '@samihult/xjog';
import { XJogLogEmitter, XJogStateChange } from '@samihult/xjog-util';
import { DigestPersistenceAdapter } from '@samihult/xjog-digest-persistence';

import { XJogDigestWriterResolvedOptions } from './XJogDigestWriterResolvedOptions';
import { XJogDigestWriterOptions } from './XJogDigestWriterOptions';
import { DigestOperations } from './Digests';

export class XJogDigestWriter extends XJogLogEmitter {
  public readonly component = 'digest/writer';

  private readonly options: XJogDigestWriterResolvedOptions;

  constructor(
    private readonly xJog: XJog,
    private readonly persistence: DigestPersistenceAdapter,
    options: XJogDigestWriterOptions,
  ) {
    super();

    this.options = {
      asyncOperation: options.asyncOperation ?? false,
      mappings: options.mappings,
    };

    this.debug('Installing an update hook');
    xJog.installUpdateHook(async (change: XJogStateChange) => {
      const trace = (...args: Array<string | Record<string, unknown>>) =>
        this.trace({ ref: change.ref, in: 'update hook' }, ...args);

      trace('Recording a digest');

      const mapping = this.options.mappings[change.ref.machineId];

      if (!mapping) {
        this.trace('No mapping, skipping');
        return;
      }

      const promise = Promise.resolve(mapping(change))
        .then(async (operations: DigestOperations | null) => {
          if (!operations) {
            return;
          }

          if (operations.upsert) {
            await this.persistence.record(change.ref, operations.upsert);
          }

          if (operations.delete) {
            await this.persistence.clear(change.ref, operations.delete);
          }
        })
        .catch((err: any) => this.error('Failed to write digest', { err }));

      if (!this.options.asyncOperation) {
        await promise;
      }
    });
  }
}
