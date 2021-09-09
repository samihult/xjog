// prettier-ignore
const tokenPool = [
  'amy', 'ben', 'cid', 'dan', 'eli', 'flo', 'guy',
  'hal', 'ian', 'jay', 'kid', 'lee', 'max', 'ned',
  'obi', 'peg', 'ray', 'stu', 'ted', 'uma', 'vic',
  'wes', 'xin', 'yen', 'zac',
]

export function getCorrelationIdentifier(): string {
  const randomIndex = Math.floor(Math.random() * tokenPool.length);
  const alphaToken = tokenPool[randomIndex];
  const numericToken = Math.floor(Math.random() * 1000);
  return `${alphaToken}-${numericToken}`;
}
