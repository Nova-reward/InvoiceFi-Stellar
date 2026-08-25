/**
 * WalletAdapter interface
 *
 * All wallet integrations must implement this interface so that application
 * logic stays decoupled from any specific wallet extension.
 */
export interface WalletAdapter {
  /** Human-readable wallet name shown in the UI */
  name: string;

  /**
   * Request the user's public key from the wallet extension.
   * Returns null when the user rejects or the extension is unavailable.
   */
  getPublicKey(): Promise<string | null>;

  /**
   * Initiate a wallet connection flow (permission prompt, etc.).
   * Returns the public key on success, null on failure / rejection.
   */
  connect(): Promise<string | null>;

  /** Disconnect / clean up any persistent connection state. */
  disconnect(): Promise<void>;

  /**
   * Sign an XDR-encoded transaction envelope.
   * @param xdr   Base-64 encoded transaction XDR
   * @param network  Stellar network passphrase
   * Returns the signed XDR string.
   */
  signTransaction(xdr: string, network: string): Promise<string>;

  /**
   * Register a callback that fires whenever the connected account changes
   * (including disconnection — publicKey will be null in that case).
   * Returns an unsubscribe function.
   */
  watchAccountChange(callback: (publicKey: string | null) => void): () => void;

  /** Returns true when the wallet extension is installed / detectable. */
  isAvailable(): boolean;
}
