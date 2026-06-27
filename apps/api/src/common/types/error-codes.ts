export const ErrorCodeMap = {
  TRUSTLINE_MISSING_001: {
    code: 'TRUSTLINE_MISSING_001',
    type: 'TRUSTLINE_MISSING',
    userMessage: 'Trustline not set for this asset. Please add trustline first.',
    displayMessage: 'Trustline Missing',
    severity: 'warning',
    action: 'ADD_TRUSTLINE',
  },
  TRUSTLINE_EXCEEDED_002: {
    code: 'TRUSTLINE_EXCEEDED_002',
    type: 'TRUSTLINE_EXCEEDED',
    userMessage: 'Trustline limit exceeded. Please increase your trustline limit.',
    displayMessage: 'Trustline Limit Exceeded',
    severity: 'error',
    action: 'INCREASE_TRUSTLINE',
  },
  INSUFFICIENT_BALANCE_003: {
    code: 'INSUFFICIENT_BALANCE_003',
    type: 'INSUFFICIENT_BALANCE',
    userMessage: 'Insufficient balance. Please add more funds.',
    displayMessage: 'Insufficient Balance',
    severity: 'error',
    action: 'ADD_FUNDS',
  },
  CONTRACT_ERROR_004: {
    code: 'CONTRACT_ERROR_004',
    type: 'CONTRACT_ERROR',
    userMessage: 'Contract execution failed. Please try again later.',
    displayMessage: 'Transaction Failed',
    severity: 'error',
    action: 'RETRY',
  },
};

export type ErrorCode = keyof typeof ErrorCodeMap;
