import { expect, test } from '@playwright/test';

test('the app loads and shows the battlefield with both armies', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('board')).toBeVisible();
  // 30 Sylvaneth models and 51 Seraphon models are on the table.
  await expect(page.locator('[data-testid="board"] .p0')).toHaveCount(30);
  await expect(page.locator('[data-testid="board"] .p1')).toHaveCount(51);
});
