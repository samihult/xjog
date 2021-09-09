import { ChartReference, getCorrelationIdentifier } from '@samihult/xjog-util';

import { ResolvedXJogOptions } from './XJogOptions';
import { XJog } from './XJog';

/**
 * Class that will handle the startup sequence.
 * @group XJog
 */
export class XJogStartupManager {
  private readonly options: ResolvedXJogOptions['startup'];

  /**
   * Internal variable for the {@link #started} getter.
   */
  private isStarted = false;

  /**
   * Has been started. Machine registrations are accepted no more.
   */
  public get started(): boolean {
    return this.isStarted;
  }

  /**
   * Internal variable for the {@link #ready} getter.
   */
  private isReady = false;

  /**
   * In addition to the initial startup sequence, the async tail of the
   * startup has completed.
   */
  public get ready(): boolean {
    return this.isReady;
  }

  // private readinessListeners = new Set<() => void>();

  /** @private Timer for startup grace period */
  private startupGracePeriodTimer: NodeJS.Timeout | null = null;
  /** @private Timer for adoption loop */
  private adoptionLoopTimer: NodeJS.Timeout | null = null;

  public constructor(private readonly xJog: XJog) {
    this.options = xJog.options.startup;
  }

  private exitAdoptionGracePeriod() {
    if (this.startupGracePeriodTimer) {
      clearTimeout(this.startupGracePeriodTimer);
      this.startupGracePeriodTimer = null;
    }
  }

  private startAdoptionGracePeriod() {
    this.exitAdoptionGracePeriod();

    this.startupGracePeriodTimer = setTimeout(
      this.forciblyOverThrowStubbornInstances.bind(this),
      this.options.gracePeriod,
    );
  }

  /**
   * Start charts and activities. Start adoption process of
   * old instances' charts. Call this after registering all the machines.
   *
   * @param cid Optional correlation id for debugging purposes.
   */
  public async start(cid: string = getCorrelationIdentifier()): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({ cid, in: 'startupManager.start', ...args });

    trace({ message: 'Overthrowing other instances' });
    await this.xJog.persistence.overthrowOtherInstances(this.xJog.id, cid);

    trace({ message: 'Entering the adoption grace period' });
    this.startAdoptionGracePeriod();

    trace({ message: 'Starting adoption process' });
    await this.adoptCharts();

    trace({ message: 'Startup completed' });
    this.isStarted = true;
  }

  public async stop(cid: string = getCorrelationIdentifier()): Promise<void> {
    const trace = (args: Record<string, any>) =>
      this.xJog.trace({ cid, in: 'startupManager.stop', ...args });

    trace({ message: 'Exiting the adoption grace period' });
    this.exitAdoptionGracePeriod();

    trace({ message: 'Stopping adoption process' });
    this.stopAdoptionLoop();

    trace({ message: 'Signal readiness' });
    this.signalReadiness();
  }

  private stopAdoptionLoop(): void {
    if (this.adoptionLoopTimer) {
      clearTimeout(this.adoptionLoopTimer);
    }
    this.adoptionLoopTimer = null;
  }

  /**
   * Adopt charts until there are no charts left to adopt. This is the gentle
   * option, and only paused charts that have zero activity counter will be
   * adopted. If this fails, {@link #forciblyOverThrowStubbornInstances} will
   * be called after the grace period.
   *
   * @private
   */
  private async adoptCharts(): Promise<void> {
    const cid = getCorrelationIdentifier();

    const trace = (args: Record<string, any>) =>
      this.xJog.trace({ cid, in: 'startupManager.adoptCharts', ...args });

    this.adoptionLoopTimer = null;

    trace({ message: 'Adopting charts' });
    const adoptedChartIdentifiers =
      await this.xJog.persistence.gentlyAdoptCharts(this.xJog.id, cid);

    const pausedChartCount = await this.xJog.persistence.getPausedChartCount(
      cid,
    );

    if (adoptedChartIdentifiers.length) {
      trace({
        message: 'Starting adopted charts',
        count: adoptedChartIdentifiers.length,
        left: pausedChartCount,
      });

      await this.startAdoptedCharts(adoptedChartIdentifiers);
    } else {
      trace({
        message: 'Could not adopt any charts',
        count: adoptedChartIdentifiers.length,
        left: pausedChartCount,
      });
    }

    if (pausedChartCount > 0) {
      trace({ message: 'More charts to adopt', pausedChartCount });

      // Restart the grace period, otherwise it could be
      // spent on a lengthy adoption process alone
      this.startAdoptionGracePeriod();

      this.adoptionLoopTimer = setTimeout(
        this.adoptCharts.bind(this),
        this.options.adoptionFrequency,
      );
    } else {
      trace({ message: 'No more charts to adopt' });
      this.exitAdoptionGracePeriod();

      trace({ message: 'Signal readiness' });
      this.signalReadiness();
    }

    trace({ message: 'Done' });
  }

  /**
   * Carried out when grace period timer fires and there are still lingering
   * charts, not ready for adoption. Grace period timer is cleared after every
   * chart is successfully adopted.
   *
   * @private
   */
  private async forciblyOverThrowStubbornInstances(): Promise<void> {
    const cid = getCorrelationIdentifier();

    const trace = (args: Record<string, any>) =>
      this.xJog.trace({
        cid,
        in: 'startupManager.forciblyOverThrowStubbornInstances',
        ...args,
      });

    this.startupGracePeriodTimer = null;

    trace({ message: 'Adopting all charts, ready or not' });
    const adoptedChartIdentifiers =
      await this.xJog.persistence.forciblyAdoptCharts(this.xJog.id, cid);

    trace({ message: 'Starting adopted charts' });
    await this.startAdoptedCharts(adoptedChartIdentifiers);

    trace({ message: 'Signal readiness' });
    this.signalReadiness();

    trace({ message: 'Done' });
  }

  /**
   * The startup routine needs to be run for a list of charts. This will
   * restart any ongoing activities etc. Intended as a post-adoption routine.
   *
   * @param refs List of chart identifiers
   * @param cid Optional correlation identifier for debugging purposes.
   *
   * @private
   */
  private async startAdoptedCharts(
    refs: ChartReference[],
    cid = getCorrelationIdentifier(),
  ): Promise<void> {
    for (const ref of refs) {
      const adoptedChart = await this.xJog.getChart(ref, cid);
      await adoptedChart?.runStep(cid);
    }
  }

  private signalReadiness(): void {
    this.isReady = true;
    this.xJog.emit('ready');

    // for (const readinessListener of this.readinessListeners) {
    //   try {
    //     readinessListener();
    //     this.readinessListeners.delete(readinessListener);
    //   } catch (error) {
    //     this.xJog.trace({
    //       in: 'startupManger.signalReadiness',
    //       level: 'warning',
    //       message: 'Failed to call a readiness listener',
    //       error,
    //     });
    //   }
    // }
  }

  // public async waitUntilReady(): Promise<void> {
  //   if (this.ready) {
  //     return Promise.resolve();
  //   }
  //
  //   return new Promise((resolve) => {
  //     this.readinessListeners.add(resolve);
  //   });
  // }
}
