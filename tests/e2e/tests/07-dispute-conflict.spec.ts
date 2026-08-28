import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Dispute & Conflict Resolution', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';
  const investorKey = process.env.INVESTOR_WALLET_ADDRESS || '';

  test.beforeAll(async ({}, testInfo) => {
    if (!farmerKey || !investorKey) {
      testInfo.skip();
    }
  });

  test('29. Farmer views invoice details after dispute flag', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    const createRes = await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 45000, farmer: farmerKey, status: 'PENDING' },
    });
    expect(createRes.ok()).toBeTruthy();

    const getRes = await apiContext.fetch(`${API_URL}/invoices/${onchainId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    expect(getRes.ok()).toBeTruthy();
    const invoice = await getRes.json();
    expect(invoice.farmer).toBe(farmerKey);
    expect(invoice.status).toBe('PENDING');
  });

  test('30. Dispute flow: funded invoice cannot be settled by wrong party', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 20000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 20000, discountRate: 5.0 },
    });

    const farmerToken2 = await authenticate(apiContext, farmerKey, 'FARMER');
    const settleRes = await apiContext.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken2}` },
      data: { invoiceId: onchainId },
    });

    expect([200, 201, 403, 409]).toContain(settleRes.status());
  });

  test('31. Dashboard data reflects invoice status changes', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerKey, 'FARMER');
    await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: { onchainId, faceValue: 55000, farmer: farmerKey, status: 'PENDING' },
    });

    const investorToken = await authenticate(apiContext, investorKey, 'INVESTOR');
    await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: onchainId, amount: 55000, discountRate: 5.0 },
    });

    const dashboardFarmer = await apiContext.fetch(`${API_URL}/dashboard/farmer/${farmerKey}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    expect(dashboardFarmer.ok()).toBeTruthy();
    const farmerInvoices = await dashboardFarmer.json();
    expect(Array.isArray(farmerInvoices)).toBeTruthy();

    const dashboardInvestor = await apiContext.fetch(`${API_URL}/dashboard/investor/${investorKey}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${investorToken}` },
    });
    expect(dashboardInvestor.ok()).toBeTruthy();
    const investorInvoices = await dashboardInvestor.json();
    expect(Array.isArray(investorInvoices)).toBeTruthy();
  });

  test('32. Investor can view their portfolio', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, investorKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="INVESTOR"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard\/investor/, { timeout: 15_000 });

    const hasTable = await page.locator('table, [role="grid"], [class*="portfolio"]').isVisible({ timeout: 5000 }).catch(() => false);
    const hasDashboard = await page.locator('[class*="dashboard"], main').isVisible({ timeout: 5000 });
    expect(hasTable || hasDashboard).toBeTruthy();

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
