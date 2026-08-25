import { Test, TestingModule } from '@nestjs/testing';
import { TrustlineService } from '../trustline.service';
import { StellarService } from '../../stellar/stellar.service';
import { TrustlineErrorType } from '../../common/errors/trustline.errors';

describe('TrustlineService', () => {
  let service: TrustlineService;
  let stellarService: StellarService;

  const mockWalletAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  const mockAssetCode = 'USDC';
  const mockAssetIssuer = 'GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVW';

  const mockStellarService = {
    accountExists: jest.fn(),
    getTrustline: jest.fn(),
    getBalance: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustlineService,
        {
          provide: StellarService,
          useValue: mockStellarService,
        },
      ],
    }).compile();

    service = module.get<TrustlineService>(TrustlineService);
    stellarService = module.get<StellarService>(StellarService);
  });

  describe('validateTrustline', () => {
    it('should return valid when trustline exists and has sufficient limit', async () => {
      mockStellarService.accountExists.mockResolvedValue(true);
      mockStellarService.getTrustline.mockResolvedValue({
        limit: '1000',
        balance: '0',
      });
      mockStellarService.getBalance.mockResolvedValue('0');

      const result = await service.validateTrustline(
        mockWalletAddress,
        mockAssetCode,
        mockAssetIssuer,
        '100',
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return MISSING_TRUSTLINE when no trustline exists', async () => {
      mockStellarService.accountExists.mockResolvedValue(true);
      mockStellarService.getTrustline.mockResolvedValue(null);

      const result = await service.validateTrustline(
        mockWalletAddress,
        mockAssetCode,
        mockAssetIssuer,
        '100',
      );

      expect(result.valid).toBe(false);
      expect(result.error.type).toBe(TrustlineErrorType.MISSING_TRUSTLINE);
    });

    it('should return TRUSTLINE_EXCEEDED when amount exceeds limit', async () => {
      mockStellarService.accountExists.mockResolvedValue(true);
      mockStellarService.getTrustline.mockResolvedValue({
        limit: '100',
        balance: '0',
      });
      mockStellarService.getBalance.mockResolvedValue('0');

      const result = await service.validateTrustline(
        mockWalletAddress,
        mockAssetCode,
        mockAssetIssuer,
        '200',
      );

      expect(result.valid).toBe(false);
      expect(result.error.type).toBe(TrustlineErrorType.TRUSTLINE_EXCEEDED);
    });

    it('should return INSUFFICIENT_BALANCE when balance is insufficient', async () => {
      mockStellarService.accountExists.mockResolvedValue(true);
      mockStellarService.getTrustline.mockResolvedValue({
        limit: '1000',
        balance: '50',
      });
      mockStellarService.getBalance.mockResolvedValue('50');

      const result = await service.validateTrustline(
        mockWalletAddress,
        mockAssetCode,
        mockAssetIssuer,
        '200',
      );

      expect(result.valid).toBe(false);
      expect(result.error.type).toBe(TrustlineErrorType.INSUFFICIENT_BALANCE);
    });
  });

  describe('parseContractError', () => {
    it('should parse MISSING_TRUSTLINE errors', () => {
      const error = new Error('trustline missing for asset USDC');
      const result = service.parseContractError(error);

      expect(result.type).toBe(TrustlineErrorType.MISSING_TRUSTLINE);
      expect(result.message).toContain('trustline');
    });

    it('should parse TRUSTLINE_EXCEEDED errors', () => {
      const error = new Error('trustline limit exceeded');
      const result = service.parseContractError(error);

      expect(result.type).toBe(TrustlineErrorType.TRUSTLINE_EXCEEDED);
      expect(result.message).toContain('exceeded');
    });

    it('should parse INSUFFICIENT_BALANCE errors', () => {
      const error = new Error('insufficient balance');
      const result = service.parseContractError(error);

      expect(result.type).toBe(TrustlineErrorType.INSUFFICIENT_BALANCE);
      expect(result.message).toContain('balance');
    });
  });
});
