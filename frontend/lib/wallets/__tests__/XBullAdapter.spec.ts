import { XBullAdapter } from '../XBullAdapter';

describe('XBullAdapter', () => {
  let adapter: XBullAdapter;

  const mockPublicKey = 'GXBULL_PUBLIC_KEY';
  const mockXdr = 'raw_xdr_string';
  const network = 'Public Global Stellar Network ; September 2015';

  beforeEach(() => {
    adapter = new XBullAdapter();
    delete (window as any).xBullSDK;
  });

  afterEach(() => {
    delete (window as any).xBullSDK;
  });

  describe('isAvailable()', () => {
    it('returns false when window.xBullSDK is not present', () => {
      expect(adapter.isAvailable()).toBe(false);
    });

    it('returns true when window.xBullSDK is present', () => {
      (window as any).xBullSDK = { connect: jest.fn(), sign: jest.fn() };
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  describe('getPublicKey()', () => {
    it('returns null before connect() is called', async () => {
      expect(await adapter.getPublicKey()).toBeNull();
    });

    it('returns the key after a successful connect()', async () => {
      (window as any).xBullSDK = {
        connect: jest.fn().mockResolvedValue({ publicKey: mockPublicKey }),
        sign: jest.fn(),
      };
      await adapter.connect();
      expect(await adapter.getPublicKey()).toBe(mockPublicKey);
    });
  });

  describe('connect()', () => {
    it('returns null when extension is not available', async () => {
      const key = await adapter.connect();
      expect(key).toBeNull();
    });

    it('returns the public key on successful connection', async () => {
      (window as any).xBullSDK = {
        connect: jest.fn().mockResolvedValue({ publicKey: mockPublicKey }),
        sign: jest.fn(),
      };
      const key = await adapter.connect();
      expect(key).toBe(mockPublicKey);
    });
  });

  describe('disconnect()', () => {
    it('clears the stored public key', async () => {
      (window as any).xBullSDK = {
        connect: jest.fn().mockResolvedValue({ publicKey: mockPublicKey }),
        sign: jest.fn(),
      };
      await adapter.connect();
      await adapter.disconnect();
      expect(await adapter.getPublicKey()).toBeNull();
    });
  });

  describe('signTransaction()', () => {
    it('throws when extension is not available', async () => {
      await expect(adapter.signTransaction(mockXdr, network)).rejects.toThrow(
        'xBull extension not available',
      );
    });

    it('throws when wallet is not connected', async () => {
      (window as any).xBullSDK = { connect: jest.fn(), sign: jest.fn() };
      await expect(adapter.signTransaction(mockXdr, network)).rejects.toThrow(
        'xBull wallet not connected',
      );
    });

    it('returns signed XDR after connecting', async () => {
      const signedXdr = 'SIGNED_XDR';
      (window as any).xBullSDK = {
        connect: jest.fn().mockResolvedValue({ publicKey: mockPublicKey }),
        sign: jest.fn().mockResolvedValue({ signedXdr }),
      };
      await adapter.connect();
      const result = await adapter.signTransaction(mockXdr, network);
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
    it('is "xBull"', () => {
      expect(adapter.name).toBe('xBull');
    });
  });
});
