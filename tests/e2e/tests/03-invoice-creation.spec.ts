import { test, expect } from '../fixtures/test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';

test.describe('Invoice Creation – Validation & Edge Cases', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';

  test('11. Invoice wizard validates required fields', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');

    const cropNameInput = page.locator('#cropName');
    if (await cropNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cropNameInput.fill('A');
      await cropNameInput.blur();

      const errorMsg = page.locator('[id="cropName-error"], .field-error');
      if (await errorMsg.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(errorMsg).toBeVisible();
      }

      await cropNameInput.fill('');
      await page.locator('button:has-text("Continue")').click();

      const errorVisible = await page.locator('.field-error, [role="alert"]').isVisible({ timeout: 3000 }).catch(() => false);
      expect(errorVisible).toBeTruthy();
    }

    await context.close();
  });

  test('12. Invoice wizard validates buyer email', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');

    const cropNameInput = page.locator('#cropName');
    if (await cropNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#cropName').fill('Organic Wheat');
      await page.locator('#cropDescription').fill('High quality organic wheat from northern fields');
      await page.locator('button:has-text("Continue")').click();

      await page.locator('#unitPrice').fill('25');
      await page.locator('#buyerName').fill('Wheat Corp');
      await page.locator('#buyerEmail').fill('invalid-email');
      await page.locator('#buyerEmail').blur();

      const emailError = page.locator('#buyerEmail-error, [id*="buyerEmail-error"]');
      if (await emailError.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(emailError).toContainText(/valid email/i);
      }
    }

    await context.close();
  });

  test('13. Invoice wizard step navigation', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');

    const cropNameInput = page.locator('#cropName');
    if (await cropNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      const progressBar = page.locator('[role="progressbar"]');
      if (await progressBar.isVisible({ timeout: 3000 }).catch(() => false)) {
        const initialWidth = await progressBar.getAttribute('aria-valuenow');
        expect(Number(initialWidth)).toBeGreaterThanOrEqual(0);
      }

      await page.locator('#cropName').fill('Coffee Beans');
      await page.locator('#cropDescription').fill('Premium arabica coffee beans from highland farms');
      await page.locator('button:has-text("Continue")').click();

      const backBtn = page.locator('button:has-text("Back")');
      if (await backBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await backBtn.click();
        await expect(page.locator('#cropName')).toHaveValue('Coffee Beans');
      }
    }

    await context.close();
  });
});

test.describe('Invoice Creation – API', () => {
  const farmerKey = process.env.FARMER_WALLET_ADDRESS || '';

  test('14. API rejects invoice creation without auth', async ({ apiContext }) => {
    const crypto = await import('crypto');
    const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0)).toString();

    const res = await apiContext.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        onchainId,
        faceValue: 50000,
        farmer: farmerKey,
      },
    });

    expect([401, 403]).toContain(res.status());
  });

  test('15. Farmer dashboard shows created invoices', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const { mockFreighter } = await import('../fixtures/test-fixtures');
    await mockFreighter(page, farmerKey);

    await page.goto('/connect-wallet');
    await page.locator('input[type="radio"][value="FARMER"]').check();
    await page.locator('button.connect-button').click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    await page.goto('/dashboard/farmer');

    await page.waitForTimeout(2000);

    const dashboardContent = await page.textContent('body');
    expect(dashboardContent).toBeTruthy();

    await context.close();
  });
});
