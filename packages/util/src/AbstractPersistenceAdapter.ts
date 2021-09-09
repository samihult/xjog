import { XJogLogEmitter } from './XJogLogEmitter';

/**
 * Abstract adapter class for XJog persistence.
 * @hideconstructor
 */
export abstract class AbstractPersistenceAdapter extends XJogLogEmitter {
  /**
   * Implement this in the subclasses for determining compatibility.
   * This is used e.g. with Postgres adapters to enable piggybacking
   * on another adapter's connection pool. Has to be same value for
   * compatible adapters, meaning adapters that can operate on the
   * same database simultaneously. E.g. for Postgres use `pg`.
   */
  public abstract readonly type: string;
}
