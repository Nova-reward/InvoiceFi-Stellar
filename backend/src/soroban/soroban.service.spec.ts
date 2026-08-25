import { SorobanService } from './soroban.service';
import { ContractErrorCode } from '../common/contract-error';

describe('SorobanService – parseContractError', () => {
  const service = new SorobanService();

  it.each([
    ['InsufficientFunds in diagnostic', 'Error: InsufficientFunds', ContractErrorCode.InsufficientFunds],
    ['InvoiceExpired in diagnostic', 'ContractError: InvoiceExpired', ContractErrorCode.InvoiceExpired],
    ['DuplicateFunding in diagnostic', 'vm trap: DuplicateFunding', ContractErrorCode.DuplicateFunding],
    ['Unauthorized in diagnostic', 'host fn trap: Unauthorized', ContractErrorCode.Unauthorized],
    ['InvalidState in diagnostic', 'panic: InvalidState', ContractErrorCode.InvalidState],
  ])('parses %s → %s', (_label, raw, expected) => {
    const err = service.parseContractError(raw);
    expect(err.code).toBe(expected);
    expect(err.name).toBe('ContractError');
  });

  it('falls back to InvalidState for unknown errors', () => {
    const err = service.parseContractError('some unknown vm error');
    expect(err.code).toBe(ContractErrorCode.InvalidState);
  });
});
