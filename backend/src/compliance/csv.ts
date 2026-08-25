/**
 * Minimal RFC 4180 CSV serialization.
 *
 * A field is quoted when it contains a comma, double-quote, or line break;
 * embedded quotes are doubled. `null`/`undefined` render as empty fields.
 * Rows use CRLF line endings per the spec.
 */

function escapeField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize `rows` to CSV using `fields` as both the column order and the
 * header row. Each row is looked up by field key.
 */
export function toCsv<T>(fields: (keyof T)[], rows: T[]): string {
  const header = fields.map((f) => escapeField(f as string)).join(',');
  const body = rows.map((row) =>
    fields.map((field) => escapeField(row[field])).join(','),
  );
  return [header, ...body].join('\r\n');
}
