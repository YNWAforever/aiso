import { expect, test } from '@playwright/test'

const baseUrl = process.env.BASE_URL
if (!baseUrl) {
  throw new Error('BASE_URL is required for the release scan gate')
}

const target = process.env.LIVE_SCAN_TARGET
if (!target) {
  throw new Error('LIVE_SCAN_TARGET is required for the release scan gate')
}

test('homepage completes one controlled live scan', async ({ page }) => {
  await page.goto('/en')
  await page.getByLabel('Website URL', { exact: true }).first().fill(target)
  await page.getByRole('button', { name: /scan/i }).first().click()

  await expect(page).toHaveURL(/\/en\/result\/[A-Za-z0-9-]+/, { timeout: 90_000 })
  await expect(page.locator('main')).toContainText(/score|checks/i)
})
