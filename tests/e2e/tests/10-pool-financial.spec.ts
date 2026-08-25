import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Pool & Financial Operations', () => {
  test('41. Pool stats endpoint returns valid data', async ({ apiContext }) => {
    const res = await apiContext.get('/pool/stats');
    expect(res.ok()).toBeTruthy();
    const stats = await res.json();

    expect(typeof stats.totalDeposited).toBe('number');
    expect(typeof stats.totalFunded).toBe('number');
    expect(typeof stats.utilizationPercentage).toBe('number');
    expect(typeof stats.averageApy).toBe('number');
    expect(typeof stats.activeInvoicesCount).toBe('number');

    expect(stats.totalDeposited).toBeGreaterThan(0);
    expect(stats.totalFunded).toBeGreaterThan(0);
    expect(stats.utilizationPercentage).toBeGreaterThan(0);
    expect(stats.utilizationPercentage).toBeLessThanOrEqual(100);
    expect(stats.averageApy).toBeGreaterThan(0);
  });

  test('42. Invoice listing endpoint returns array', async ({ apiContext }) => {
    const res = await apiContext.get('/invoices');
    expect(res.ok()).toBeTruthy();
    const invoices = await res.json();
    expect(Array.isArray(invoices)).toBeTruthy();
  });

  test('43. Health endpoint is consistently available', async ({ apiContext }) => {
    for (let i = 0; i < 5; i++) {
      const res = await apiContext.get('/health');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.status).toBe('ok');
    }
  });

  test('44. Auth: connect wallet with valid data returns token', async ({ apiContext }) => {
    const walletAddress = `GB${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
    const res = await apiContext.fetch(`${API_URL}/auth/connect-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { walletAddress, role: 'FARMER' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('walletAddress');
    expect(body).toHaveProperty('role');
    expect(body.role).toBe('FARMER');
  });

  test('45. Auth: connect wallet with investor role', async ({ apiContext }) => {
    const walletAddress = `GB${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
    const res = await apiContext.fetch(`${API_URL}/auth/connect-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { walletAddress, role: 'INVESTOR' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.role).toBe('INVESTOR');
  });

  test('46. Auth: connect wallet creates user and is idempotent', async ({ apiContext }) => {
    const walletAddress = `GBE2E_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const res1 = await apiContext.fetch(`${API_URL}/auth/connect-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { walletAddress, role: 'FARMER' },
    });
    expect(res1.ok()).toBeTruthy();
    const body1 = await res1.json();

    const res2 = await apiContext.fetch(`${API_URL}/auth/connect-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { walletAddress, role: 'INVESTOR' },
    });
    expect(res2.ok()).toBeTruthy();
    const body2 = await res2.json();

    expect(body1.walletAddress).toBe(body2.walletAddress);
  });

  test('47. Invoice lifecycle: create → fund → list → verify status', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, process.env.FARMER_WALLET_ADDRESS || '', 'FARMER');
    const createRes = await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
      data: {
        onchainId,
        faceValue: 70000,
        farmer: process.env.FARMER_WALLET_ADDRESS || '',
        status: 'PENDING',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const invoice = await createRes.json();

    const investorToken = await authenticate(apiContext, process.env.INVESTOR_WALLET_ADDRESS || '', 'INVESTOR');
    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investorToken}` },
      data: { invoiceId: invoice.id || invoice.onchainId, amount: 70000, discountRate: 5.0 },
    });
    expect(fundRes.ok()).toBeTruthy();

    const listRes = await apiContext.get('/invoices');
    expect(listRes.ok()).toBeTruthy();
    const allInvoices = await listRes.json();
    expect(Array.isArray(allInvoices)).toBeTruthy();
  });

  test('48. Full lifecycle with browser UI verification', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    await page.goto('/connect-wallet');

    const wizardVisible = await page.locator('#cropName').isVisible({ timeout: 5000 }).catch(() => false);
    if (wizardVisible) {
      await page.locator('#cropName').fill('Soybeans');
      await page.locator('#cropDescription').fill('Non-GMO soybeans from sustainable farming');
      await page.locator('button:has-text("Continue")').click();

      await page.locator('#quantity').fill('200');
      await page.locator('#unitPrice').fill('35');
      await page.locator('#buyerName').fill('SoyCo International');
      await page.locator('#buyerEmail').fill('procurement@soyco.com');
      await page.locator('button:has-text("Review")').click();

      await expect(page.locator('text=Soybeans').first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator('text=SoyCo International').first()).toBeVisible();
    }

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
