import {
  AbstractPersistenceAdapter,
  ChartReference,
} from '@samihult/xjog-util';

import { DigestEntry } from './DigestEntry';
import { DigestQuery } from './DigestQuery';
import { DigestEntries } from './DigestEntries';
import { Subject } from 'rxjs';

export type ChartReferenceWithTimestamp = ChartReference & {
  /** Milliseconds from epoch  */
  timestamp: number;
};

/**
 * Abstract adapter class for XJog journal persistence.
 * @hideconstructor
 */
export abstract class DigestPersistenceAdapter extends AbstractPersistenceAdapter {
  public readonly newDigestEntriesSubject = new Subject<ChartReference>();

  protected constructor() {
    super();
  }

  ////////////////////////////////////////////////////////////////////////////////
  // Abstract low-level methods that need to be implemented by a concrete subclass

  protected abstract upsertDigest(
    ref: ChartReference,
    key: string,
    value: string,
  ): Promise<number>;

  protected abstract emitDigestEntryNotification(
    ref: ChartReference,
  ): Promise<void>;

  protected abstract deleteDigest(
    ref: ChartReference,
    key: string,
  ): Promise<number>;

  public abstract deleteByChart(ref: ChartReference): Promise<number>;

  public abstract readDigest(
    ref: ChartReference,
    key: string,
  ): Promise<DigestEntry | null>;

  public abstract readByChart(ref: ChartReference): Promise<DigestEntries>;

  public abstract queryDigests(query: DigestQuery): Promise<ChartReferenceWithTimestamp[]>;

  public async clear(ref: ChartReference, keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.deleteDigest(ref, key);
    }
    await this.emitDigestEntryNotification(ref);
  }

  public async record(
    ref: ChartReference,
    entries: {
      [key: string]: string;
    },
  ): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      await this.upsertDigest(ref, key, value);
    }
    await this.emitDigestEntryNotification(ref);
  }
}
