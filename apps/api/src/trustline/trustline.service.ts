import { Injectable, Logger } from '@nestjs/common';
import { StellarService } from '../stellar/stellar.service';
import { TrustlineError, TrustlineErrorType } from '../common/errors/trustline.errors';

@Injectable()
export class TrustlineService {
  private readonly logger = new Logger(TrustlineService.name);

  constructor(private readonly stellarService: StellarService) {}

  /**
   * Pre-flight trustline check before submitting transaction
   */
  async validateTrustline(
    walletAddress: string,
    assetCode: string,
    assetIssuer: string,
    amount: string,
  ): Promise<{ valid: boolean; error?: TrustlineError }> {
    try {
      // Check if account exists
      const accountExists = await this.stellarService.accountExists(walletAddress);
      if (!accountExists) {
        return {
          valid: false,
          error: new TrustlineError(
            TrustlineErrorType.CONTRACT_ERROR,
            'Account not found',
            { walletAddress },
          ),
        };
      }

      // Check trustline
      const trustline = await this.stellarService.getTrustline(
        walletAddress,
        assetCode,
        assetIssuer,
      );

      if (!trustline) {
        this.logger.warn(`No trustline found for wallet ${walletAddress} for asset ${assetCode}`);
        return {
          valid: false,
          error: new TrustlineError(
            TrustlineErrorType.MISSING_TRUSTLINE,
            'Trustline not set for this asset. Please add trustline first.',
            { walletAddress, assetCode, assetIssuer },
          ),
        };
      }

      // Check if trustline limit is sufficient
      const amountBigInt = BigInt(amount);
      const limitBigInt = BigInt(trustline.limit);

      if (amountBigInt > limitBigInt) {
        this.logger.warn(
          `Trustline limit exceeded for wallet ${walletAddress}. ` +
          `Amount: ${amount}, Limit: ${trustline.limit}`,
        );
        return {
          valid: false,
          error: new TrustlineError(
            TrustlineErrorType.TRUSTLINE_EXCEEDED,
            `Trustline limit exceeded. Current limit: ${trustline.limit}. Requested amount: ${amount}`,
            { walletAddress, assetCode, amount, limit: trustline.limit },
          ),
        };
      }

      // Also check balance (optional additional check)
      const balance = await this.stellarService.getBalance(walletAddress, assetCode, assetIssuer);
      if (balance && BigInt(balance) < amountBigInt) {
        return {
          valid: false,
          error: new TrustlineError(
            TrustlineErrorType.INSUFFICIENT_BALANCE,
            `Insufficient balance. Available: ${balance}. Requested: ${amount}`,
            { walletAddress, balance, amount },
          ),
        };
      }

      return { valid: true };
    } catch (error) {
      this.logger.error(`Trustline validation error: ${error.message}`, error.stack);
      return {
        valid: false,
        error: new TrustlineError(
          TrustlineErrorType.CONTRACT_ERROR,
          `Failed to validate trustline: ${error.message}`,
          { error: error.message },
        ),
      };
    }
  }

  /**
   * Parse Soroban contract error responses
   */
  parseContractError(error: any): { type: TrustlineErrorType; message: string } {
    const errorMessage = error?.message || error?.toString() || '';

    // Check for trustline-related errors
    if (errorMessage.includes('trustline') || errorMessage.includes('Trustline')) {
      if (errorMessage.includes('missing') || errorMessage.includes('does not exist')) {
        return {
          type: TrustlineErrorType.MISSING_TRUSTLINE,
          message: 'Trustline missing for this asset. Please add trustline.',
        };
      }
      if (errorMessage.includes('limit') || errorMessage.includes('exceed')) {
        return {
          type: TrustlineErrorType.TRUSTLINE_EXCEEDED,
          message: 'Trustline limit exceeded. Please increase your trustline limit.',
        };
      }
    }

    // Check for balance errors
    if (errorMessage.includes('balance') || errorMessage.includes('insufficient')) {
      return {
        type: TrustlineErrorType.INSUFFICIENT_BALANCE,
        message: 'Insufficient balance for this transaction.',
      };
    }

    return {
      type: TrustlineErrorType.CONTRACT_ERROR,
      message: `Contract error: ${errorMessage}`,
    };
  }
}
