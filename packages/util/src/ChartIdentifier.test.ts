import { ChartIdentifier } from './ChartIdentifier';

describe('ChartIdentifier', () => {
  it('Consumes ChartReferences', () => {
    const identifier = new ChartIdentifier({
      machineId: 'this machine',
      chartId: 'that chart',
    });

    expect(identifier.machineId).toBe('this machine');
    expect(identifier.chartId).toBe('that chart');
    expect(identifier.host).toBe(undefined);
    expect(identifier.uri.href).toBe('xjog+chart:/this%20machine/that%20chart');
  });

  it('Consumes ChartReferences with host', () => {
    const identifier = new ChartIdentifier({
      host: 'host.domain.tld:123',
      machineId: 'this machine',
      chartId: 'that chart',
    });

    expect(identifier.machineId).toBe('this machine');
    expect(identifier.chartId).toBe('that chart');
    expect(identifier.host).toBe('host.domain.tld:123');
    expect(identifier.uri.href).toBe(
      'xjog+chart://host.domain.tld:123/this%20machine/that%20chart',
    );
  });

  it('Consumes URI strings', () => {
    const identifier = new ChartIdentifier(
      'xjog+chart:machine%20id/chart%20id%201',
    );

    expect(identifier.machineId).toBe('machine id');
    expect(identifier.chartId).toBe('chart id 1');
    expect(identifier.host).toBe(undefined);
    expect(identifier.uri.href).toBe('xjog+chart:machine%20id/chart%20id%201');
  });

  it('Consumes URI strings with host', () => {
    const identifier = new ChartIdentifier(
      'xjog+chart://www.google.com/machine%20id/chart%20id%201',
    );

    expect(identifier.machineId).toBe('machine id');
    expect(identifier.chartId).toBe('chart id 1');
    expect(identifier.host).toBe('www.google.com');
    expect(identifier.uri.href).toBe(
      'xjog+chart://www.google.com/machine%20id/chart%20id%201',
    );
  });

  it('Consumes URIs', () => {
    const uri = new URL(
      'xjog+chart://www.google.com/machine%20id/chart%20id%201',
    );
    const identifier = new ChartIdentifier(uri);

    expect(identifier.machineId).toBe('machine id');
    expect(identifier.chartId).toBe('chart id 1');
    expect(identifier.host).toBe('www.google.com');
    expect(identifier.uri.href).toBe(uri.href);
  });

  it('Matches identifiers', () => {
    expect(
      ChartIdentifier.from({ machineId: 'm', chartId: 'c' })?.matches(
        'xjog+chart:/m/c',
      ),
    ).toBe(true);
  });
});
