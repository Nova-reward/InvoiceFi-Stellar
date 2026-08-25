import { test, expect } from '@playwright/test'

test.describe('Optimistic Updates and Offline Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard/investor/pool')
  })

  test('should show pending state immediately on invoice action', async ({ page, context }) => {
    // Intercept and delay the API response to simulate slow network
    await page.route('**/api/invoices/*/fund', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.continue()
    })

    // Click fund button
    const fundButton = page.locator('button:has-text("Fund")')
    await fundButton.first().click()

    // UI should show optimistic state immediately
    const pendingBadge = page.locator('[aria-label="Pending confirmation"]')
    await expect(pendingBadge).toBeVisible()

    // After confirmation, badge should disappear
    await page.waitForTimeout(2500)
    await expect(pendingBadge).not.toBeVisible()
  })

  test('should handle offline state gracefully', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true)

    // Offline indicator should appear within 3 seconds
    const offlineBanner = page.locator('[aria-label="You are offline"]')
    await expect(offlineBanner).toBeVisible({ timeout: 4000 })

    // Actions should still work optimistically
    const fundButton = page.locator('button:has-text("Fund")')
    await fundButton.first().click()

    // Should show optimistic state
    const pendingBadge = page.locator('[aria-label="Pending confirmation"]')
    await expect(pendingBadge).toBeVisible()

    // Go back online
    await context.setOffline(false)

    // Offline banner should dismiss
    await expect(offlineBanner).not.toBeVisible({ timeout: 4000 })

    // Pending action should be synced
    await page.waitForTimeout(2000)
    await expect(pendingBadge).not.toBeVisible()
  })

  test('should show conflict resolution when data diverges', async ({ page, context }) => {
    // Make an optimistic update
    const fundButton = page.locator('button:has-text("Fund")')
    await fundButton.first().click()

    // While pending, simulate server conflict by mocking different response
    await page.route('**/api/invoices/*/state', async (route) => {
      await route.abort('failed')
    })

    // Wait for conflict modal
    const conflictModal = page.locator('[role="dialog"]')
    await expect(conflictModal).toBeVisible({ timeout: 5000 })

    // Should show both versions
    const localVersion = page.locator('text=Your Changes')
    const serverVersion = page.locator('text=Latest Data')
    await expect(localVersion).toBeVisible()
    await expect(serverVersion).toBeVisible()

    // User can resolve conflict
    const resolveButton = page.locator('button:has-text("Keep My Changes")')
    await expect(resolveButton).toBeVisible()
  })

  test('should cache dashboard data for offline access', async ({ page, context }) => {
    // Load page normally
    await page.goto('/dashboard/investor/pool')
    await page.waitForLoadState('networkidle')

    // Go offline
    await context.setOffline(true)

    // Reload page
    await page.reload()

    // Table should still be visible with cached data
    const table = page.locator('table')
    await expect(table).toBeVisible()

    // At least some rows should be visible
    const rows = page.locator('tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
  })

  test('should announce offline status to screen readers', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true)

    // Find the status live region
    const statusRegion = page.locator('[role="status"][aria-live]')
    await expect(statusRegion).toContainText(/offline|connection/i)
  })

  test('should handle rapid network changes', async ({ page, context }) => {
    const offlineBanner = page.locator('[aria-label*="offline"]')

    // Toggle offline/online multiple times
    for (let i = 0; i < 3; i++) {
      await context.setOffline(true)
      await page.waitForTimeout(1000)

      await context.setOffline(false)
      await page.waitForTimeout(1000)
    }

    // App should remain functional
    const fundButton = page.locator('button:has-text("Fund")')
    await expect(fundButton).toBeVisible()
  })
})
