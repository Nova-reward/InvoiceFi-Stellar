import { decimalToMinorUnits, minorUnitsToDecimal } from './amount';

describe('minorUnitsToDecimal', () => {
  it('formats minor units with the given precision', () => {
    expect(minorUnitsToDecimal(10000000n, 7)).toBe('1.0000000');
    expect(minorUnitsToDecimal(12345678n, 7)).toBe('1.2345678');
    expect(minorUnitsToDecimal(1n, 7)).toBe('0.0000001');
    expect(minorUnitsToDecimal(0n, 7)).toBe('0.0000000');
  });

  it('formats negatives (e.g. a realized loss)', () => {
    expect(minorUnitsToDecimal(-5000000n, 7)).toBe('-0.5000000');
  });

  it('handles zero-decimal assets', () => {
    expect(minorUnitsToDecimal(1500n, 0)).toBe('1500');
  });
});

describe('decimalToMinorUnits', () => {
  it('parses whole and fractional decimals', () => {
    expect(decimalToMinorUnits('1000', 7)).toBe(10000000000n);
    expect(decimalToMinorUnits('1000.50', 7)).toBe(10005000000n);
    expect(decimalToMinorUnits('0.0000001', 7)).toBe(1n);
  });

  it('round-trips with minorUnitsToDecimal', () => {
    const minor = decimalToMinorUnits('1234.5678900', 7);
    expect(minorUnitsToDecimal(minor, 7)).toBe('1234.5678900');
  });

  it('rejects malformed input', () => {
    expect(() => decimalToMinorUnits('abc', 7)).toThrow();
    expect(() => decimalToMinorUnits('1.2.3', 7)).toThrow();
    expect(() => decimalToMinorUnits('', 7)).toThrow();
  });

  it('rejects precision beyond the asset decimals', () => {
    expect(() => decimalToMinorUnits('1.12345678', 7)).toThrow(/precision/);
  });
});
