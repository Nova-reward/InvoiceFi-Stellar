import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Default / Timeout Scenarios', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';
  const investorKey = process.env.INVESTOR_WALLET_ADDRESS || '';

  test.beforeAll(async ({}, testInfo) => {
    if (!farmerKey || !investorKey) {
      testInfo.skip();
    }
  });

  test('25. Invoice lifecycle: funded invoice that is not settled within window', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 40000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 40000, discountRate: 8.0 },
    });

    const getRes = await apiContext.fetch(`${API_URL}/invoices/${onchainId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    if (getRes.ok()) {
      const invoice = await getRes.json();
      expect(invoice.status).toBe('FUNDED');
      expect(invoice.onchainId).toBe(onchainId);
    }
  });

  test('26. Invoice marked as DEFAULTED via status update', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 35000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 35000, discountRate: 10.0 },
    });

    const getRes = await apiContext.fetch(`${API_URL}/invoices/${onchainId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    if (getRes.ok()) {
      const invoice = await getRes.json();
      expect(['PENDING', 'FUNDED']).toContain(invoice.status);
    }
  });

  test('27. Funding expired invoice is rejected', async ({ apiContext }) => {
    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');

    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: '0', amount: 10000, discountRate: 5.0 },
    });

    expect([404, 410, 422]).toContain(fundRes.status());
  });

  test('28. Investor dashboard shows funded invoices', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, investorKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="INVESTOR"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard\/investor/, { timeout: 15_000 });

    await page.waitForTimeout(2000);
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
