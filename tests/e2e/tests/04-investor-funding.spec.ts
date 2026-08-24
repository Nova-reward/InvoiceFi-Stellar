import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Investor Funding & Insufficient Liquidity', () => {
  const investorKey = process.env.INVESTOR_WALLET_ADDRESS || '';
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';

  test.beforeAll(async ({}, testInfo) => {
    if (!investorKey || !farmerKey) {
      testInfo.skip();
    }
  });

  test('16. Investor funds a pending invoice', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    const createRes = await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${farmerToken}`,
      },
      data: {
        onchainId,
        faceValue: 75000,
        farmer: farmerKey,
        status: 'PENDING',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const invoice = await createRes.json();

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${investorToken}`,
      },
      data: {
        invoiceId: invoice.id,
        amount: 75000,
        discountRate: 5.0,
      },
    });
    expect(fundRes.ok()).toBeTruthy();
    const funded = await fundRes.json();

    const getRes = await apiContext.fetch(`${API_URL}/invoices/${onchainId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    if (getRes.ok()) {
      const fetched = await getRes.json();
      expect(fetched.status).toBe('FUNDED');
    }
  });

  test('17. Cannot fund an already-funded invoice (409)', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${farmerToken}`,
      },
      data: { onchainId, faceValue: 50000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');

    const fundRes1 = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${investorToken}`,
      },
      data: { invoiceId: onchainId, amount: 50000, discountRate: 5.0 },
    });
    expect(fundRes1.ok()).toBeTruthy();

    const fundRes2 = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${investorToken}`,
      },
      data: { invoiceId: onchainId, amount: 50000, discountRate: 5.0 },
    });
    expect([409, 422]).toContain(fundRes2.status());
  });

  test('18. Funding amount exceeding invoice value is rejected', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${farmerToken}`,
      },
      data: { onchainId, faceValue: 10000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${investorToken}`,
      },
      data: { invoiceId: onchainId, amount: 999999999, discountRate: 5.0 },
    });
    expect([409, 422]).toContain(fundRes.status());
  });

  test('19. Funding non-existent invoice returns 404', async ({ apiContext }) => {
    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${investorToken}`,
      },
      data: { invoiceId: '999999999', amount: 50000, discountRate: 5.0 },
    });
    expect(fundRes.status()).toBe(404);
  });

  test('20. Investor portfolio page loads after connection', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, investorKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="INVESTOR"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard\/investor/, { timeout: 15_000 });

    const content = await page.textContent('body');
    expect(content).toBeTruthy();

    await context.close();
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
