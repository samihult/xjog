export function waitFor(delay: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(delay, 0));
  });
}
