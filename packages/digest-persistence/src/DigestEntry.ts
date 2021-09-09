import { ChartReference } from '@samihult/xjog-util';

export type DigestEntry = {
  created: number;
  timestamp: number;
  ref: ChartReference;
  key: string;
  value: string;
};
