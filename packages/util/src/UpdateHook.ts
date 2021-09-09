import { XJogStateChange } from './XJogStateChange';

export type UpdateHook = (change: XJogStateChange) => void | Promise<void>;
