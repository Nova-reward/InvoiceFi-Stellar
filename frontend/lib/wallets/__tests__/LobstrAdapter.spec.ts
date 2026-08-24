import { LobstrAdapter } from '../LobstrAdapter';

describe('LobstrAdapter', () => {
  let adapter: LobstrAdapter;

  beforeEach(() => {
    adapter = new LobstrAdapter();
    // Remove any stale window mock
    delete (window as any).lobstrVault;
  });

  afterEach(() => {
    delete (window as any).lobstrVault;
  });

  describe('isAvailable()', () => {
    it('returns false when window.lobstrVault is not present', () => {
      expect(adapter.isAvailable()).toBe(false);
    });

    it('returns true when window.lobstrVault is present', () => {
      (window as any).lobstrVault = { getPublicKey: jest.fn(), signTransaction: jest.fn() };
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  describe('getPublicKey()', () => {
    it('returns null when extension is not available', async () => {
      const key = await adapter.getPublicKey();
      expect(key).toBeNull();
    });

    it('returns the public key from the extension', async () => {
      const mockKey = 'GCLOBSTR_PUBLIC_KEY';
      (window as any).lobstrVault = {
        getPublicKey: jest.fn().mockResolvedValue(mockKey),
        signTransaction: jest.fn(),
      };
      const key = await adapter.getPublicKey();
      expect(key).toBe(mockKey);
    });
  });

  describe('connect()', () => {
    it('returns null when extension is not available', async () => {
      const key = await adapter.connect();
      expect(key).toBeNull();
    });

    it('returns the public key on successful connection', async () => {
      const mockKey = 'GCLOBSTR_PUBLIC_KEY';
      (window as any).lobstrVault = {
        getPublicKey: jest.fn().mockResolvedValue(mockKey),
        signTransaction: jest.fn(),
      };
      const key = await adapter.connect();
      expect(key).toBe(mockKey);
    });
  });

  describe('disconnect()', () => {
    it('resolves without throwing', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('signTransaction()', () => {
    it('throws when extension is not available', async () => {
      await expect(adapter.signTransaction('xdr_here', 'Public Global Stellar Network ; September 2015')).rejects.toThrow(
        'LOBSTR Vault extension not available',
      );
    });

    it('returns signed XDR from the extension', async () => {
      const signedXdr = 'SIGNED_XDR';
      (window as any).lobstrVault = {
        getPublicKey: jest.fn(),
        signTransaction: jest.fn().mockResolvedValue(signedXdr),
      };
      const result = await adapter.signTransaction('raw_xdr', 'Test SDF Network ; September 2015');
      expect(result).toBe(signedXdr);
    });
  });

  describe('watchAccountChange()', () => {
    it('returns a no-op unsubscribe function', () => {
      const unsubscribe = adapter.watchAccountChange(jest.fn());
      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('name', () => {
    it('is "LOBSTR"', () => {
      expect(adapter.name).toBe('LOBSTR');
    });
  });
});
