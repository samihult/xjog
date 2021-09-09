import { XJogLogEmitter, ChartReference } from '@samihult/xjog-util';
import { concat, from, Observable, concatMap } from 'rxjs';

import {
  ChartReferenceWithTimestamp,
  DigestPersistenceAdapter,
  DigestQuery,
} from '@samihult/xjog-digest-persistence';

export class XJogDigestReader extends XJogLogEmitter {
  public readonly component = 'digest/reader';

  constructor(private readonly persistence: DigestPersistenceAdapter) {
    super();
  }

  public async queryDigests(
    query: DigestQuery,
  ): Promise<ChartReferenceWithTimestamp[]> {
    return this.persistence.queryDigests(query);
  }

  public observeDigests(
    query: DigestQuery,
  ): Observable<ChartReferenceWithTimestamp> {
    return concat(
      from(this.queryDigests(query)).pipe(
        // From array to individual items
        concatMap((refs: ChartReferenceWithTimestamp[]) => refs),
      ),
      from(this.persistence.newDigestEntriesSubject).pipe(
        concatMap((ref: ChartReference) => {
          return this.persistence.queryDigests({
            ...query,
            machineId: ref.machineId,
            chartId: ref.chartId,
          });
        }),
        // From array to individual items
        concatMap((refs: ChartReference[]) => refs),
      ),
    );
  }
}
