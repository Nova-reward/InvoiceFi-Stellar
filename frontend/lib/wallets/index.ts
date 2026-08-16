export type { WalletAdapter } from './WalletAdapter';
export { FreighterAdapter } from './FreighterAdapter';
export { LobstrAdapter } from './LobstrAdapter';
export { XBullAdapter } from './XBullAdapter';

import { FreighterAdapter } from './FreighterAdapter';
import { LobstrAdapter } from './LobstrAdapter';
import { XBullAdapter } from './XBullAdapter';
import type { WalletAdapter } from './WalletAdapter';

/**
 * All supported wallet adapters in display order.
 * WalletSessionGuard and the connect-wallet page iterate this list so that
 * no component needs to hard-code individual wallet names.
 */
export const WALLET_ADAPTERS: WalletAdapter[] = [
  new FreighterAdapter(),
  new LobstrAdapter(),
  new XBullAdapter(),
];
