import { toCsv } from './csv';

describe('toCsv', () => {
  it('emits a header row and CRLF-separated data rows', () => {
    const csv = toCsv(['a', 'b'], [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv(['name', 'note'], [
      { name: 'a,b', note: 'he said "hi"' },
      { name: 'line1\nline2', note: 'plain' },
    ]);
    expect(csv).toBe(
      'name,note\r\n"a,b","he said ""hi"""\r\n"line1\nline2",plain',
    );
  });

  it('renders null and undefined as empty fields', () => {
    const csv = toCsv(['a', 'b'], [{ a: null, b: undefined }]);
    expect(csv).toBe('a,b\r\n,');
  });

  it('produces a header-only document for empty rows', () => {
    expect(toCsv(['x', 'y'], [])).toBe('x,y');
  });
});
