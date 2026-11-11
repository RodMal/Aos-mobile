/**
 * Mouse, wheel and keyboard behaviour that only exists on desktop. The shared flows (select,
 * move, abilities, a full game) run on every project through the helpers in app.spec.ts and
 * friends; this file adds what a phone cannot do or has no equivalent for.
 */
import { expect, test } from '@playwright/test';
import {
  ahead,
  boardPoint,
  boardScale,
  drag,
  endPhaseUntil,
  isDesktop,
  modelCentre,
  modelTablePos,
  selectFromRoster,
  startDeploy,
  startGame,
} from './helpers.js';

test.beforeEach(() => {
  test.skip(!isDesktop(), 'mouse and keyboard only');
});

test('the layout puts the board and the sheet side by side and fills the window', async ({
  page,
}) => {
  await startGame(page);
  const board = (await page.getByTestId('board').boundingBox())!;
  const sheet = (await page.getByTestId('sheet').boundingBox())!;
  expect(sheet.x).toBeGreaterThanOrEqual(board.x + board.width - 2);
  expect(sheet.width).toBeLessThanOrEqual(430);
  expect(board.width + sheet.width).toBeGreaterThan(1270);
  // No page scroll bars and the table is centred in the board area.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const table = (await page.locator('.table').first().boundingBox())!;
  expect(Math.abs(table.x + table.width / 2 - (board.x + board.width / 2))).toBeLessThan(4);
});

test('the mouse wheel zooms about the pointer and the zoom buttons agree', async ({ page }) => {
  await startGame(page);
  const s0 = await boardScale(page);
  const at = await boardPoint(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => boardScale(page)).toBeGreaterThan(s0 * 1.3);
  const s1 = await boardScale(page);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => boardScale(page)).toBeLessThan(s1);
  await page.mouse.wheel(0, -800);
  await expect.poll(() => boardScale(page)).toBeGreaterThan(s1);
  // Dragging with the mouse pans without changing the scale.
  const s2 = await boardScale(page);
  const anchor = await modelCentre(page, '0:0', 0).catch(() => null);
  const p = await boardPoint(page);
  await drag(page, p, { x: p.x + 50, y: p.y + 30 });
  expect(await boardScale(page)).toBeCloseTo(s2, 3);
  if (anchor) {
    const moved = await modelCentre(page, '0:0', 0);
    expect(moved.x - anchor.x).toBeCloseTo(50, -1);
  }
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => boardScale(page)).toBeLessThan(s2);
  await page.getByRole('button', { name: 'Show whole table' }).click();
  await expect.poll(() => boardScale(page)).toBeCloseTo(s0, 1);
});

test('the board shows a grab cursor and a move cursor on the ghost', async ({ page }) => {
  await startGame(page);
  const cursor = () => page.getByTestId('board').evaluate((e) => getComputedStyle(e).cursor);
  expect(await cursor()).toBe('grab');
  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  await page.locator('[data-action="normal"]').click();
  await expect(page.getByTestId('board')).toHaveClass(/placing/);
  const ghost = page.locator('[data-ghost-model="0"]');
  expect(await ghost.evaluate((e) => getComputedStyle(e).cursor)).toBe('move');
});

test('Escape closes drawers, the ability panel and the unit card; Enter confirms a move', async ({
  page,
}) => {
  await startGame(page);
  await page.getByRole('button', { name: 'Roster' }).click();
  await expect(page.getByTestId('roster')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('roster')).toHaveCount(0);

  await page.getByTestId('menu-button').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('open-army-rules').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await selectFromRoster(page, '0:0');
  await page.locator('[data-ability="97df-e136-9fb4-5aca"]').click();
  await expect(page.getByTestId('ability-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ability-panel')).toHaveCount(0);
  await expect(page.getByTestId('unit-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('unit-panel')).toHaveCount(0);

  // Enter confirms a legal placement, but never ends a phase.
  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  const before = await modelTablePos(page, '[data-unit-id="0:6"] [data-model="0"]');
  await page.locator('[data-action="normal"]').click();
  const from = await boardPoint(page);
  await drag(page, from, await ahead(page, from, 2));
  await expect(page.getByTestId('place-status')).toContainText('Ready to confirm');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('place-panel')).toHaveCount(0);
  const after = await modelTablePos(page, '[data-unit-id="0:6"] [data-model="0"]');
  expect(after.x - before.x).toBeGreaterThan(1.5);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('phase').locator('[aria-current="step"]')).toHaveText('Movement');
});

test('alternating deployment: place one unit with the mouse', async ({ page }) => {
  await startDeploy(page);
  const panel = page.getByTestId('place-panel');
  await expect(panel).toContainText('Deploy');
  const unit = await panel.getByRole('heading').textContent();
  // The draft starts at a suggested legal spot; nudge it with the mouse, then confirm.
  const confirm = page.getByTestId('place-confirm');
  await expect(confirm).toBeEnabled();
  const ghost = await modelCentre(page, '', 0, true);
  await drag(page, ghost, { x: ghost.x + 8, y: ghost.y }, 4);
  if (await confirm.isDisabled()) {
    // The nudge left the territory: take the suggestion again.
    await page.getByRole('button', { name: 'Auto' }).click();
  }
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('[data-unit-id^="0:"] [data-model]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText(/deployed/i);
  expect(unit).toBeTruthy();
});
