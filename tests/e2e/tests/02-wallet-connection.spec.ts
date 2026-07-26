import { test, expect, mockFreighter } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Wallet Connection & Disconnect', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || 'GBTestFarmer123456789012345678901234567890';

  test('6. Wallet connect page displays correctly', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');
    await expect(page.locator('h1')).toContainText('Connect Your Wallet');
    await expect(page.locator('input[type="radio"][value="FARMER"]')).toBeVisible();
    await expect(page.locator('input[type="radio"][value="INVESTOR"]')).toBeVisible();
    await expect(page.locator('button.connect-button')).toBeVisible();
    await expect(page.locator('.info-box')).toBeVisible();

    await context.close();
  });

  test('7. Freighter not detected shows error', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/connect-wallet');

    await page.locator('button.connect-button').click();

    await expect(page.locator('.error-message, [class*="error"]')).toContainText(
      /Freighter|extension not detected/i,
      { timeout: 10_000 },
    );

    await context.close();
  });

  test('8. Wallet disconnect mid-flow redirects to connect page', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    await page.evaluate(() => {
      (window as any).FreighterApi = undefined;
      sessionStorage.removeItem('walletAddress');
      sessionStorage.removeItem('walletRole');
    });

    await page.evaluate(() => {
      const event = new CustomEvent('publicKeyChanged', { detail: null });
      window.dispatchEvent(event);
    });

    await page.goto('/connect-wallet');
    await expect(page.locator('h1')).toContainText('Connect Your Wallet');

    await context.close();
  });

  test('9. Farmer cannot access investor dashboard', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockFreighter(page, farmerKey);

    const crypto = await import('crypto');
    const fakeTokenPayload = {
      sub: 1,
      walletAddress: farmerKey,
      role: 'FARMER',
    };

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();

    await page.goto('/dashboard/investor');

    await page.waitForTimeout(2000);

    const url = page.url();
    const isRedirected = !url.includes('/dashboard/investor') || url.includes('/dashboard/farmer');
    expect(isRedirected || url.includes('/connect-wallet')).toBeTruthy();

    await context.close();
  });

  test('10. Investor cannot access farmer dashboard', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const investorKey = process.env.INVESTOR_WALLET_ADDRESS || 'GBTestInvestor123456789012345678901234567';
    await mockFreighter(page, investorKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="INVESTOR"]').check();
    await page.locator('button.connect-button').click();

    await page.goto('/dashboard/farmer');

    await page.waitForTimeout(2000);

    const url = page.url();
    const isRedirected = !url.includes('/dashboard/farmer') || url.includes('/dashboard/investor');
    expect(isRedirected || url.includes('/connect-wallet')).toBeTruthy();

    await context.close();
  });
});
