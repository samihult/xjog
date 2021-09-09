import { ChartReference } from '@samihult/xjog-util';

export type FullStateQuery =
  | Array<ChartReference>
  | {
      ref?: ChartReference;
      parentRef?: ChartReference;
      machineId?: string;

      afterId?: number;
      afterAndIncludingId?: number;
      beforeId?: number;
      beforeAndIncludingId?: number;

      createdAfterAndIncluding?: number;
      createdBeforeAndIncluding?: number;
      updatedAfterAndIncluding?: number;
      updatedBeforeAndIncluding?: number;

      limit?: number;
      offset?: number;
      order?: 'ASC' | 'DESC';
    };
