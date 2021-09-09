import { XJogStateChange } from '@samihult/xjog-util';

import { DigestOperations } from './Digests';

export type XJogDigestWriterOptions = {
  asyncOperation?: boolean;
  mappings: {
    [machineId: string]: (
      change: XJogStateChange,
    ) => Promise<DigestOperations | null> | DigestOperations | null;
  };
};
