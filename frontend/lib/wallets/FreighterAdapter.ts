import type { WalletAdapter } from './WalletAdapter';

interface FreighterApi {
  getPublicKey(): Promise<string | null>;
  signTransaction(xdr: string, opts: { networkPassphrase: string }): Promise<string>;
  on(event: string, callback: (data: any) => void): void;
  off(event: string, callback: (data: any) => void): void;
}

function getFreighterApi(): FreighterApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as any).FreighterApi as FreighterApi | undefined;
}

/**
 * FreighterAdapter
 *
 * Wraps the existing Freighter browser-extension API without changing any
 * observable behaviour.  All logic from useFreighterListener.ts is preserved
 * here so that the hook can delegate to this adapter instead of touching
 * window.FreighterApi directly.
 */
export class FreighterAdapter implements WalletAdapter {
  readonly name = 'Freighter';

  isAvailable(): boolean {
    return !!getFreighterApi();
  }

  async getPublicKey(): Promise<string | null> {
    const api = getFreighterApi();
    if (!api) return null;
    return api.getPublicKey();
  }

  async connect(): Promise<string | null> {
    return this.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Freighter has no explicit disconnect API; session cleanup is handled
    // externally (sessionStorage / cookie) just as it was before.
  }

  async signTransaction(xdr: string, network: string): Promise<string> {
    const api = getFreighterApi();
    if (!api) throw new Error('Freighter extension not available');
    return api.signTransaction(xdr, { networkPassphrase: network });
  }

  watchAccountChange(callback: (publicKey: string | null) => void): () => void {
    const api = getFreighterApi();
    if (!api) return () => {};

    const handler = (publicKey: string | null) => callback(publicKey);
    api.on('publicKeyChanged', handler);

    return () => api.off('publicKeyChanged', handler);
  }
}
