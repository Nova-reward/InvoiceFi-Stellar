import type { WalletAdapter } from './WalletAdapter';

/**
 * LOBSTR Vault Adapter (stub)
 *
 * LOBSTR Vault exposes a browser-extension API under window.lobstrVault.
 * This adapter follows the WalletAdapter contract; full implementation
 * should replace the TODO stubs once the LOBSTR Vault SDK is integrated.
 *
 * Reference: https://lobstr.co/vault
 */

interface LobstrVaultApi {
  getPublicKey(): Promise<string>;
  signTransaction(xdr: string): Promise<string>;
}

function getLobstrApi(): LobstrVaultApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as any).lobstrVault as LobstrVaultApi | undefined;
}

export class LobstrAdapter implements WalletAdapter {
  readonly name = 'LOBSTR';

  isAvailable(): boolean {
    return !!getLobstrApi();
  }

  async getPublicKey(): Promise<string | null> {
    const api = getLobstrApi();
    if (!api) return null;
    // TODO: handle user-rejection errors and return null accordingly
    return api.getPublicKey();
  }

  async connect(): Promise<string | null> {
    return this.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // TODO: call api.disconnect() once LOBSTR Vault exposes it
  }

  async signTransaction(xdr: string, _network: string): Promise<string> {
    const api = getLobstrApi();
    if (!api) throw new Error('LOBSTR Vault extension not available');
    // TODO: pass network passphrase when the SDK supports it
    return api.signTransaction(xdr);
  }

  watchAccountChange(callback: (publicKey: string | null) => void): () => void {
    // TODO: subscribe to LOBSTR Vault account-change events when the SDK
    //       exposes an event emitter.
    // For now we return a no-op unsubscribe.
    void callback; // suppress unused-variable warning
    return () => {};
  }
}
