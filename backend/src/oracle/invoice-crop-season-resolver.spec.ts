import { NullInvoiceCropSeasonResolver } from './invoice-crop-season-resolver';

describe('NullInvoiceCropSeasonResolver', () => {
  it('always resolves to undefined (no invoice is crop-yield-gated by default)', async () => {
    const resolver = new NullInvoiceCropSeasonResolver();
    expect(await resolver.resolve('any-invoice-id')).toBeUndefined();
  });
});
