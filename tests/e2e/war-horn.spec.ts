/** Kurnothi War-horn: Belthanos is wholly within 12" of himself, so his Move of 12" shows as 14". */
import { expect, test } from '@playwright/test';
import { selectFromRoster, startGame } from './helpers.js';

test('Belthanos shows the War-horn Move on his card', async ({ page }, info) => {
  await startGame(page);
  await selectFromRoster(page, '0:1');
  await expect(page.getByTestId('stat-line')).toContainText('14"');
  await page.screenshot({ path: info.outputPath(`war-horn-${info.project.name}.png`) });
});
