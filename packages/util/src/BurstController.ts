export type BurstControllerOptions = {
  burstMaxSize: number;
  burstMaxWaitTime: number /** ms */;
  burstMaxIdleTime: number /** ms */;

  onEntry?: () => void;
  onExit?: () => void;
};

export class BurstController {
  private isBursting = false;

  private burstTimeout: NodeJS.Timeout | null = null;
  private burstIdleTimeout: NodeJS.Timeout | null = null;
  private burstCount = 0;

  constructor(private readonly options: BurstControllerOptions) {}

  /**
   * @returns `true` if in bursting mode
   */
  public fire() {
    if (!this.isBursting) {
      return this.enter();
    }

    this.burstCount++;

    if (this.burstCount > this.options.burstMaxSize) {
      this.exit();
    }

    if (this.burstIdleTimeout) {
      clearInterval(this.burstIdleTimeout);
    }

    this.burstIdleTimeout = setTimeout(
      this.exit,
      this.options.burstMaxIdleTime,
    );
  }

  /**
   * Usually no need to call directly
   */
  public enter() {
    // NOTE: might already be in burst mode
    this.isBursting = true;

    if (this.burstTimeout) {
      clearTimeout(this.burstTimeout);
    }

    if (this.burstIdleTimeout) {
      clearTimeout(this.burstIdleTimeout);
    }

    this.burstTimeout = setTimeout(this.exit, this.options.burstMaxWaitTime);
    this.burstIdleTimeout = setTimeout(
      this.exit,
      this.options.burstMaxIdleTime,
    );

    this.options.onEntry?.();
  }

  /**
   * Usually no need to call directly
   */
  public exit() {
    this.isBursting = false;
    this.burstCount = 0;

    if (this.burstIdleTimeout) {
      clearInterval(this.burstIdleTimeout);
    }

    if (this.burstTimeout) {
      clearInterval(this.burstTimeout);
    }

    this.options.onExit?.();
  }
}
