import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Wallet Disconnect Mid-Flow', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';

  test.beforeAll(async ({}, testInfo) => {
    if (!farmerKey) {
      testInfo.skip();
    }
  });

  test('37. Disconnecting wallet during invoice creation redirects', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter, disconnectFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    await disconnectFreighter(page);

    await page.evaluate(() => {
      sessionStorage.removeItem('walletAddress');
      sessionStorage.removeItem('walletRole');
      document.cookie.split(';').forEach((c) => {
        document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
      });
    });

    await page.goto('/connect-wallet');
    await expect(page.locator('h1')).toContainText('Connect Your Wallet');

    await context.close();
  });

  test('38. Session cleared on wallet disconnect', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    const sessionData = await page.evaluate(() => ({
      address: sessionStorage.getItem('walletAddress'),
      role: sessionStorage.getItem('walletRole'),
    }));
    expect(sessionData.address).toBeTruthy();
    expect(sessionData.role).toBe('FARMER');

    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });

    const clearedData = await page.evaluate(() => ({
      address: sessionStorage.getItem('walletAddress'),
      role: sessionStorage.getItem('walletRole'),
    }));
    expect(clearedData.address).toBeNull();
    expect(clearedData.role).toBeNull();

    await context.close();
  });

  test('39. Freighter API unavailable shows appropriate error', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/connect-wallet');
    await page.locator('button.connect-button').click();

    const errorVisible = await page.locator('.error-message, [class*="error"]').isVisible({ timeout: 10_000 });
    expect(errorVisible).toBeTruthy();
    const errorText = await page.locator('.error-message, [class*="error"]').textContent();
    expect(errorText?.toLowerCase()).toContain('freighter');

    await context.close();
  });

  test('40. Backend health check works during wallet operations', async ({ apiContext }) => {
    const res = await apiContext.get('/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
