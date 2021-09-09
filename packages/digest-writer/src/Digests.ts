export type Digests = { [key: string]: string };

export type DigestOperations = {
  upsert?: Digests;
  delete?: string[];
};
