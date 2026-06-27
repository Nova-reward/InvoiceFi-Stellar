export enum TrustlineErrorType {
  MISSING_TRUSTLINE = 'MISSING_TRUSTLINE',
  TRUSTLINE_EXCEEDED = 'TRUSTLINE_EXCEEDED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
}

export class TrustlineError extends Error {
  type: TrustlineErrorType;
  code: string;
  details?: any;

  constructor(type: TrustlineErrorType, message: string, details?: any) {
    super(message);
    this.type = type;
    this.code = this.getErrorCode(type);
    this.details = details;
    this.name = 'TrustlineError';
  }

  private getErrorCode(type: TrustlineErrorType): string {
    const codes = {
      [TrustlineErrorType.MISSING_TRUSTLINE]: 'TRUSTLINE_MISSING_001',
      [TrustlineErrorType.TRUSTLINE_EXCEEDED]: 'TRUSTLINE_EXCEEDED_002',
      [TrustlineErrorType.INSUFFICIENT_BALANCE]: 'INSUFFICIENT_BALANCE_003',
      [TrustlineErrorType.CONTRACT_ERROR]: 'CONTRACT_ERROR_004',
    };
    return codes[type];
  }
}
