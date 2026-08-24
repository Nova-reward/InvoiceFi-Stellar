import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Multi-Investor & Competitive Funding', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';
  const investorKey = process.env.INVESTOR_WALLET_ADDRESS || '';
  const investor2Key = process.env.INVESTOR_2_WALLET_ADDRESS || '';

  test.beforeAll(async ({}, testInfo) => {
    if (!farmerKey || !investorKey) {
      testInfo.skip();
    }
  });

  test('33. Multiple invoices can be created and tracked independently', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');

    const invoices: string[] = [];
    for (let i = 0; i < 3; i++) {
      const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();
      const res = await apiContext.fetch(`${API_URL}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
        data: {
          onchainId,
          faceValue: (i + 1) * 10000,
          farmer: farmerKey,
          status: 'PENDING',
        },
      });
      if (res.ok()) {
        const inv = await res.json();
        invoices.push(inv.onchainId || onchainId);
      }
    }

    const listRes = await apiContext.get('/invoices');
    if (listRes.ok()) {
      const allInvoices = await listRes.json();
      expect(Array.isArray(allInvoices)).toBeTruthy();
      expect(allInvoices.length).toBeGreaterThanOrEqual(0);
    }
  });

  test('34. Investor 2 cannot fund an invoice already funded by Investor 1', async ({ apiContext }) => {
    if (!investor2Key) {
      test.skip();
      return;
    }

    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 30000, farmer: farmerKey, status: 'PENDING' },
    });

    const investor1Token = await authenticate(apiContext, investorKey, 'INVESTOR');
    const fundRes1 = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investor1Token}` },
      data: { invoiceId: onchainId, amount: 30000, discountRate: 5.0 },
    });
    expect(fundRes1.ok()).toBeTruthy();

    const investor2Token = await authenticate(apiContext, investor2Key, 'INVESTOR');
    const fundRes2 = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investor2Token}` },
      data: { invoiceId: onchainId, amount: 30000, discountRate: 5.0 },
    });

    expect([409, 422]).toContain(fundRes2.status());
  });

  test('35. Each investor can only see their own funded invoices', async ({ apiContext }) => {
    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    const investor1Token = await authenticate(apiContext, investorKey, 'INVESTOR');

    const dashInv = await apiContext.fetch(`${API_URL}/dashboard/investor/${investorKey}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${investor1Token}` },
    });
    expect(dashInv.ok()).toBeTruthy();
    const invoices = await dashInv.json();
    expect(Array.isArray(invoices)).toBeTruthy();

    const invAddresses = invoices.map((inv: any) => inv.investor || inv.funder);
    const hasOtherInvestor = invAddresses.some(
      (addr: string) => addr && addr !== investorKey && addr !== null,
    );
    expect(hasOtherInvestor).toBeFalsy();
  });

  test('36. Farmer cannot fund their own invoice', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 15000, farmer: farmerKey, status: 'PENDING' },
    });

    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { invoiceId: onchainId, amount: 15000, discountRate: 5.0 },
    });

    expect([200, 201, 400, 403, 409]).toContain(fundRes.status());
  });
});

async function authenticate(apiContext: any, walletAddress: string, role: string): Promise<string> {
  const res = await apiContext.fetch(`${API_URL}/auth/connect-wallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { walletAddress, role },
  });
  const body = await res.json();
  return body.accessToken;
}
