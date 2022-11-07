import { ChartReference } from './ChartReference';

export class ChartIdentifier implements ChartReference {
  public static readonly protocol = 'xjog+chart';

  public readonly uri: URL;

  // TODO throws an error ???
  constructor(input: string | URL | ChartReference) {
    // URL
    if (input instanceof URL) {
      this.uri = new URL(input.href);
    }

    // ChartReference (or ChartIdentifier)
    else if (ChartIdentifier.isChartReference(input)) {
      const { host, machineId, chartId } = input;

      this.uri = new URL(
        `${ChartIdentifier.protocol}:/${ChartIdentifier.joinSegments(
          host ? '/' + host : null,
          machineId,
          chartId,
        )}`,
      );
    }

    // string
    else {
      this.uri = new URL(input);

      if (!this.uri.protocol) {
        this.uri.protocol = ChartIdentifier.protocol;
      }
    }

    if (this.uri.protocol !== `${ChartIdentifier.protocol}:`) {
      throw new Error(
        `Wrong protocol ${this.uri.protocol}, expected ${ChartIdentifier.protocol}:`,
      );
    }

    if (!this.machineId) {
      throw new Error('Failed to parse machine id');
    }

    if (!this.chartId) {
      throw new Error('Failed to parse chart id');
    }
  }

  private static joinSegments(
    ...segments: Array<string | undefined | null>
  ): string {
    const truthySegments = segments.filter(Boolean) as string[];

    if (!truthySegments.length) {
      return '';
    }

    const normalizedSegments = [];
    for (const segment of truthySegments) {
      normalizedSegments.push(...segment.split('/').filter(Boolean));
    }

    const path = normalizedSegments.join('/');

    const startsWithSlash = truthySegments[0].startsWith('/');
    return startsWithSlash ? '/' + path : path;
  }

  private get pathSegments(): string[] {
    return this.uri.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  }

  public get host(): string | undefined {
    return this.uri.host || undefined;
  }

  private getPathSegment(index: number): string | null {
    const pathSegments = this.pathSegments;
    if (index < 0) {
      return pathSegments[pathSegments.length + index] ?? null;
    } else {
      return pathSegments[index] ?? null;
    }
  }

  public get machineId(): string {
    const machineId = this.getPathSegment(-2);
    if (!machineId) {
      throw new Error(`Invalid path: /${this.pathSegments.join('/')}`);
    }
    return machineId;
  }

  public get chartId(): string {
    const chartId = this.getPathSegment(-1);
    if (!chartId) {
      throw new Error(`Invalid path: /${this.pathSegments.join('/')}`);
    }
    return chartId;
  }

  public get ref(): ChartReference {
    return {
      machineId: this.machineId,
      chartId: this.chartId,
    };
  }

  public matches(input: unknown): boolean {
    const ref = ChartIdentifier.from(input);
    return ref?.machineId === this.machineId && ref?.chartId === this.chartId;
  }

  public static isChartReference(
    candidate: unknown,
  ): candidate is ChartReference {
    return (
      typeof candidate === 'object' &&
      candidate !== null &&
      'machineId' in candidate &&
      'chartId' in candidate
    );
  }

  public static from(input: unknown): ChartIdentifier | null {
    try {
      // Let the constructor sort this out
      return new ChartIdentifier(input as string | URL | ChartReference);
    } catch {
      return null;
    }
  }
}

export function referencesMatch(
  a: string | URL | ChartReference,
  b: string | URL | ChartReference,
): boolean {
  return ChartIdentifier.from(a)?.matches(b) ?? false;
}

/**
 * For e.g. filtering arrays
 */
export function matchingReference(
  ref: string | URL | ChartReference,
): (input: string | URL | ChartReference) => boolean {
  return (input: string | URL | ChartReference) => referencesMatch(input, ref);
}
