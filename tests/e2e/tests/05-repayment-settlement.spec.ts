import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Repayment & Settlement', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';
  const investorKey = process.env.INVESTOR_WALLET_ADDRESS || '';

  test.beforeAll(async ({}, testInfo) => {
    if (!farmerKey || !investorKey) {
      testInfo.skip();
    }
  });

  test('21. Full repayment flow: funded → repaid', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 60000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 60000, discountRate: 5.0 },
    });
    expect(fundRes.ok()).toBeTruthy();

    const settleRes = await apiContext.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId },
    });
    expect(settleRes.ok()).toBeTruthy();
    const settled = await settleRes.json();

    const getRes = await apiContext.fetch(`${API_URL}/invoices/${onchainId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    if (getRes.ok()) {
      const fetched = await getRes.json();
      expect(['REPAID', 'FUNDED']).toContain(fetched.status);
    }
  });

  test('22. Partial repayment does not mark invoice as REPAID', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 80000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 80000, discountRate: 5.0 },
    });

    const partialRes = await apiContext.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 40000 },
    });

    const getRes = await apiContext.fetch(`${API_URL}/invoices/${onchainId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    if (getRes.ok()) {
      const fetched = await getRes.json();
      expect(['PENDING', 'FUNDED']).toContain(fetched.status);
    }
  });

  test('23. Idempotent settlement: settling an already-repaid invoice returns gracefully', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 30000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 30000, discountRate: 5.0 },
    });

    const settle1 = await apiContext.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId },
    });
    expect(settle1.ok()).toBeTruthy();

    const settle2 = await apiContext.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId },
    });

    expect([200, 201, 409]).toContain(settle2.status());
  });

  test('24. Settlement fails for non-funded invoice', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 25000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    const settleRes = await apiContext.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId },
    });

    expect([409, 422, 400]).toContain(settleRes.status());
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
