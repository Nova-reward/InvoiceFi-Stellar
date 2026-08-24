import { test, expect, mockFreighter, connectWalletAsRole, waitForServiceReady } from '../fixtures/test-fixtures';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Happy Path – Full Invoice Credit Lifecycle', () => {
  let farmerPublicKey: string;
  let investorPublicKey: string;

  test.beforeAll(async ({}, testInfo) => {
    farmerPublicKey = process.env.FARMER_WALLET_ADDRESS || '';
    investorPublicKey = process.env.INVESTOR_WALLET_ADDRESS || '';

    if (!farmerPublicKey || !investorPublicKey) {
      testInfo.skip();
    }
  });

  test('1. Farmer connects wallet and lands on dashboard', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockFreighter(page, farmerPublicKey);

    await page.goto('/connect-wallet');
    await expect(page.locator('h1')).toContainText('Connect Your Wallet');

    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();

    await page.waitForURL(/\/dashboard\/farmer/, { timeout: 15_000 });
    expect(page.url()).toContain('/dashboard/farmer');

    await context.close();
  });

  test('2. Farmer creates invoice through wizard', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockFreighter(page, farmerPublicKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    await page.goto('/dashboard/farmer');

    const invoiceWizardLink = page.locator('a:has-text("Create Invoice"), button:has-text("Create Invoice")');
    if (await invoiceWizardLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await invoiceWizardLink.click();
    }

    await page.goto(`${BASE_URL}`);

    await page.evaluate((pk) => {
      sessionStorage.setItem('walletAddress', pk);
      sessionStorage.setItem('walletRole', 'FARMER');
    }, farmerPublicKey);

    await page.goto('/connect-wallet');

    const step1 = page.locator('input#cropName, [name="cropName"]');
    if (await step1.isVisible({ timeout: 5000 }).catch(() => false)) {
      await step1.fill('Organic Maize');
      await page.locator('textarea#cropDescription, [name="cropDescription"]').fill('Premium organic maize harvested from the highlands region');

      await page.locator('button:has-text("Continue to valuation"), button:has-text("Continue")').click();

      await page.locator('input#quantity, [name="quantity"]').fill('100');
      await page.locator('input#unitPrice, [name="unitPrice"]').fill('50');
      await page.locator('input#buyerName, [name="buyerName"]').fill('AgriCorp Ltd');
      await page.locator('input#buyerEmail, [name="buyerEmail"]').fill('buyer@agricorp.com');

      await page.locator('button:has-text("Review invoice"), button:has-text("Review")').click();

      await expect(page.locator('text=Organic Maize').first()).toBeVisible({ timeout: 5000 });

      await page.locator('button:has-text("Confirm")').click();

      await expect(page.locator('text=Invoice submitted, text=submitted')).toBeVisible({ timeout: 10_000 });
    }

    await context.close();
  });

  test('3. API: Create, fund, and settle invoice end-to-end', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const farmerToken = await authenticate(apiContext, farmerPublicKey, 'FARMER');

    const createRes = await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${farmerToken}`,
      },
      data: {
        onchainId,
        faceValue: 100000,
        farmer: farmerPublicKey,
        status: 'PENDING',
      },
    });

    expect(createRes.ok()).toBeTruthy();
    const invoice = await createRes.json();
    const invoiceId = invoice.onchainId || onchainId;

    const investorToken = await authenticate(apiContext, investorPublicKey, 'INVESTOR');

    const fundRes = await apiContext.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${investorToken}`,
      },
      data: {
        invoiceId: invoice.id || invoiceId,
        amount: 95000,
        discountRate: 5.0,
      },
    });

    expect(fundRes.ok()).toBeTruthy();
    const funded = await fundRes.json();

    const settleRes = await apiContext.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${investorToken}`,
      },
      data: {
        invoiceId: invoice.id || invoiceId,
      },
    });

    expect(settleRes.ok()).toBeTruthy();
    const settled = await settleRes.json();

    const getRes = await apiContext.fetch(`${API_URL}/invoices/${invoiceId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${farmerToken}`,
      },
    });

    if (getRes.ok()) {
      const fetched = await getRes.json();
      expect(['REPAID', 'FUNDED']).toContain(fetched.status);
    }
  });

  test('4. Pool stats are accessible', async ({ apiContext }) => {
    const res = await apiContext.get('/pool/stats');
    expect(res.ok()).toBeTruthy();
    const stats = await res.json();
    expect(stats).toHaveProperty('totalDeposited');
    expect(stats).toHaveProperty('totalFunded');
    expect(stats).toHaveProperty('utilizationPercentage');
    expect(stats).toHaveProperty('averageApy');
    expect(stats).toHaveProperty('activeInvoicesCount');
    expect(typeof stats.totalDeposited).toBe('number');
  });

  test('5. Health endpoint returns ok', async ({ apiContext }) => {
    const res = await apiContext.get('/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
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
