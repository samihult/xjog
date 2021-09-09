import { applyPatch, Operation } from 'rfc6902';

export function nullSafeApplyJsonDiff<OutputType>(
  input: any,
  patch: Operation[],
): OutputType {
  if (patch.length === 1 && patch[0].op === 'replace' && patch[0].path === '') {
    return patch[0].value ?? null;
  } else if (
    typeof input === 'string' ||
    typeof input === 'number' ||
    input === null ||
    input === undefined
  ) {
    throw new Error('Complex patch but input is not an object');
  }

  const output = JSON.parse(JSON.stringify(input));
  applyPatch(output, patch);
  return output;
}
