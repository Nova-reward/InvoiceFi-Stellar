import type { WalletAdapter } from './WalletAdapter';

/**
 * xBull Wallet Adapter (stub)
 *
 * xBull exposes a browser-extension API under window.xBullSDK (the xBull SDK).
 * This adapter follows the WalletAdapter contract; full implementation should
 * replace the TODO stubs once the xBull SDK is integrated.
 *
 * Reference: https://xbull.app
 */

interface XBullSdkApi {
  connect(): Promise<{ publicKey: string }>;
  sign(opts: { xdr: string; publicKey: string; network: string }): Promise<{ signedXdr: string }>;
}

function getXBullApi(): XBullSdkApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as any).xBullSDK as XBullSdkApi | undefined;
}

export class XBullAdapter implements WalletAdapter {
  readonly name = 'xBull';

  private _publicKey: string | null = null;

  isAvailable(): boolean {
    return !!getXBullApi();
  }

  async getPublicKey(): Promise<string | null> {
    return this._publicKey;
  }

  async connect(): Promise<string | null> {
    const api = getXBullApi();
    if (!api) return null;
    // TODO: handle user-rejection errors and return null accordingly
    const result = await api.connect();
    this._publicKey = result.publicKey ?? null;
    return this._publicKey;
  }

  async disconnect(): Promise<void> {
    this._publicKey = null;
    // TODO: call api.disconnect() once xBull SDK exposes it
  }

  async signTransaction(xdr: string, network: string): Promise<string> {
    const api = getXBullApi();
    if (!api) throw new Error('xBull extension not available');
    if (!this._publicKey) throw new Error('xBull wallet not connected');
    const result = await api.sign({ xdr, publicKey: this._publicKey, network });
    return result.signedXdr;
  }

  watchAccountChange(callback: (publicKey: string | null) => void): () => void {
    // TODO: subscribe to xBull account-change events when the SDK exposes
    //       an event emitter.
    void callback; // suppress unused-variable warning
    return () => {};
  }
}
