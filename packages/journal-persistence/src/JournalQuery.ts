import { ChartReference } from '@samihult/xjog-util';

export type JournalQuery =
  | Array<ChartReference>
  | {
      ref?: ChartReference;

      afterId?: number;
      afterAndIncludingId?: number;
      beforeId?: number;
      beforeAndIncludingId?: number;

      updatedAfterAndIncluding?: number;
      updatedBeforeAndIncluding?: number;

      limit?: number;
      offset?: number;
      order?: 'ASC' | 'DESC';
    };
