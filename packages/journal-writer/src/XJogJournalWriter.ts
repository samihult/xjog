import { XJog } from '@samihult/xjog';
import { XJogLogEmitter, XJogStateChange } from '@samihult/xjog-util';
import { JournalPersistenceAdapter } from '@samihult/xjog-journal-persistence';

import { XJogJournalWriterOptions } from './XJogJournalWriterOptions';
import { XJogJournalWriterResolvedOptions } from './XJogJournalWriterResolvedOptions';

export class XJogJournalWriter extends XJogLogEmitter {
  public readonly component = 'journal/writer';

  private readonly options: XJogJournalWriterResolvedOptions;

  constructor(
    private readonly xJog: XJog,
    private readonly persistence: JournalPersistenceAdapter,
    options?: XJogJournalWriterOptions,
  ) {
    super();

    this.options = {
      asyncOperation: options?.asyncOperation ?? false,
    };

    this.debug('Installing an update hook');
    xJog.installUpdateHook(async (change: XJogStateChange) => {
      this.trace('Recording a change', { ref: change.ref });
      const promise = this.persistence
        .record(
          this.xJog.id,
          change.ref,
          change.parentRef,
          change.event,
          change.old?.value ?? null,
          change.old?.context ?? null,
          change.new?.value ?? null,
          change.new?.context ?? null,
        )
        .catch((err: any) =>
          this.error('Failed to write journal entries', { err }),
        );

      if (!this.options.asyncOperation) {
        await promise;
      }
    });
  }
}
