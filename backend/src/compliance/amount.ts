/**
 * Fixed-point helpers for asset amounts.
 *
 * On-chain amounts are stored as integer minor units (`BigInt`) to avoid
 * floating-point drift. Regulatory documents show both the exact minor-units
 * integer and a human-readable decimal, so these helpers convert between the
 * two without ever going through `number`.
 */

/** Default decimal precision for Stellar assets such as USDC. */
export const DEFAULT_ASSET_DECIMALS = 7;

/** Format integer minor units as a fixed-point decimal string. */
export function minorUnitsToDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const sign = negative ? '-' : '';
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/**
 * Parse a decimal amount (e.g. a threshold like "1000" or "1000.50") into
 * integer minor units. Rejects malformed input and fractional precision beyond
 * `decimals`.
 */
export function decimalToMinorUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid decimal amount: "${value}"`);
  }
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new Error(
      `Amount "${value}" exceeds ${decimals} decimal places of precision`,
    );
  }
  const scaled = `${whole}${fraction.padEnd(decimals, '0')}`;
  const magnitude = BigInt(scaled);
  return sign === '-' ? -magnitude : magnitude;
}
