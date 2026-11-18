/** The measuring tool: two points, or a unit and a point, give a distance in inches. */
import { expect, test } from '@playwright/test';
import { ahead, boardPoint, boardScale, modelCentre, startGame, tapAt } from './helpers.js';

test('measure two points and a unit to a point, then switch it off', async ({ page }, info) => {
  await startGame(page);
  const toggle = page.getByTestId('measure-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // Two free points about 10 inches apart (a tap may snap to a nearby objective or corner).
  const scale = await boardScale(page);
  const start = await ahead(page, await boardPoint(page), 0, 8);
  const end = await ahead(page, start, 10);
  await tapAt(page, start);
  await tapAt(page, end);
  const readout = page.getByTestId('measure-readout');
  await expect(readout).toBeVisible();
  const free = Number(await readout.getAttribute('data-inches'));
  const screen = Math.hypot(end.x - start.x, end.y - start.y) / scale;
  expect(Math.abs(free - screen)).toBeLessThan(4);
  await page.screenshot({ path: `test-results/measure-${info.project.name}.png` });

  // A unit and a point: measured from the base edge, so shorter than from its centre.
  const unitId = (await page.locator('[data-unit-id]').first().getAttribute('data-unit-id'))!;
  const model = await modelCentre(page, unitId, 0);
  await tapAt(page, model);
  await tapAt(page, end);
  await expect(readout).toBeVisible();
  const toUnit = Number(await readout.getAttribute('data-inches'));
  const fromCentre = Math.hypot(end.x - model.x, end.y - model.y) / scale;
  expect(toUnit).toBeLessThan(fromCentre + 0.1);
  expect(toUnit).toBeGreaterThanOrEqual(0);

  // Off: the line goes and taps select units again.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(readout).toHaveCount(0);
});
