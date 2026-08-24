import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// ─── axe helper ──────────────────────────────────────────────────────────────

export async function checkA11y(container: HTMLElement, options = {}) {
  const results = await axe(container, {
    rules: {
      region: { enabled: true },
    },
    ...options,
  });

  expect(results).toHaveNoViolations();
  return results;
}

export default checkA11y;

// ─── Color contrast utilities ─────────────────────────────────────────────────

/**
 * Parses a 3- or 6-digit hex color string (with or without '#') into
 * normalized [r, g, b] values in the range [0, 1].
 *
 * @throws if the string is not a valid hex color.
 */
export function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '');

  if (clean.length === 3) {
    const [r, g, b] = clean.split('').map((c) => parseInt(c + c, 16) / 255);
    return [r, g, b];
  }

  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [r, g, b];
  }

  throw new Error(`Invalid hex color: "${hex}"`);
}

/**
 * Converts a single 8-bit sRGB channel value (0–1) to its linear-light
 * equivalent using the IEC 61966-2-1 piecewise function.
 */
function linearize(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * Returns the relative luminance of a color as defined by WCAG 2.x.
 * Input is a normalized [r, g, b] triplet in the range [0, 1].
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * linearize(r) +
    0.7152 * linearize(g) +
    0.0722 * linearize(b)
  );
}

/**
 * Computes the WCAG 2.x contrast ratio between two hex colors.
 *
 * The ratio is always ≥ 1 (lighter color is always the numerator).
 *
 * @param hex1 - First color as a hex string, e.g. `"#5b21b6"` or `"5b21b6"`.
 * @param hex2 - Second color as a hex string.
 * @returns Contrast ratio rounded to two decimal places.
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * @example
 * contrastRatio('#5b21b6', '#ede9fe'); // 7.57 — passes AA
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(parseHex(hex1));
  const l2 = relativeLuminance(parseHex(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return parseFloat(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * Jest matcher helper — asserts that two colors meet WCAG 2.1 AA contrast.
 *
 * Defaults to the AA small-text threshold (4.5:1).
 * Pass `{ large: true }` to use the large-text threshold (3:1) instead.
 *
 * @example
 * expectContrastAA('#5b21b6', '#ede9fe');
 * expectContrastAA('#ffffff', '#767676', { large: true });
 */
export function expectContrastAA(
  foreground: string,
  background: string,
  options: { large?: boolean } = {},
): void {
  const threshold = options.large ? 3 : 4.5;
  const ratio = contrastRatio(foreground, background);
  expect(ratio).toBeGreaterThanOrEqual(threshold);
}
