export function pickIntegerOption<InputType>(
  value: InputType,
  defaultValue: number,
  minimumValue = Number.MIN_VALUE,
  trace?: (...args: any[]) => void,
): number {
  const numericValue = Number(value);

  const unconstrainedValue = Number.isFinite(numericValue)
    ? numericValue
    : defaultValue;

  if (unconstrainedValue < minimumValue) {
    trace?.({
      level: 'warning',
      message: 'Value is below the absolute minimum, defaulting to the minimum',
      value,
      minimumValue,
    });
  }

  const constrainedValue = Math.max(minimumValue, unconstrainedValue);

  return Math.floor(constrainedValue);
}
