import { expect, test } from '@playwright/test';
import {
  boardPoint,
  boardScale,
  endPhaseUntil,
  modelCentre,
  modelTablePos,
  pinch,
  selectFromRoster,
  startGame,
  touchDrag,
} from './helpers.js';

test('loads with both armies on the table', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('[data-unit-id^="0:"] [data-model]')).toHaveCount(30);
  await expect(page.locator('[data-unit-id^="1:"] [data-model]')).toHaveCount(51);
  await expect(page.getByTestId('round')).toContainText('Round 1');
  await expect(page.getByTestId('decision')).toContainText('Your hero phase');
});

test('tapping a unit on the board opens its card with full ability text', async ({ page }) => {
  await startGame(page);
  // Zoom in on the Dryads first so the tap is unambiguous, then tap one of their models.
  await selectFromRoster(page, '0:6');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('unit-panel')).toHaveCount(0);
  await page.touchscreen.tap(
    ...(Object.values(await modelCentre(page, '0:6', 4)) as [number, number]),
  );
  await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-unit', '0:6');
  await expect(page.getByTestId('unit-name')).toHaveText('Dryads');
  await expect(page.getByTestId('stat-line')).toContainText('6"');
  await page.getByTestId('details-toggle').click();
  const card = page.getByTestId('full-card');
  await expect(card).toContainText('One With The Forest');
  await expect(card).toContainText('Subtract 1 from hit rolls and wound rolls');
});

test('the roster selects enemy units too, without actions', async ({ page }) => {
  await startGame(page);
  await selectFromRoster(page, '1:5');
  await expect(page.getByTestId('unit-name')).toHaveText('Saurus Warriors');
  await expect(page.getByTestId('unit-actions')).toHaveCount(0);
  await expect(page.locator('[data-unit-id="1:5"]')).toHaveClass(/selected/);
});

test('a full move: select, Move, drag the ghost by touch, confirm', async ({ page }) => {
  await startGame(page);
  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  const before = await modelTablePos(page, '[data-unit-id="0:6"] [data-model="0"]');
  await page.locator('[data-action="normal"]').click();
  await expect(page.getByTestId('place-panel')).toBeVisible();
  const scale = await boardScale(page);
  const from = await boardPoint(page);
  // Player 0 sits at the bottom: screen up is towards the enemy (+x on the table).
  await touchDrag(page, from, { x: from.x, y: from.y - 3 * scale });
  await expect(page.getByTestId('place-status')).toContainText('Ready to confirm');
  await expect(page.getByTestId('measure')).toContainText('3');
  await page.getByTestId('place-confirm').click();
  await expect(page.getByTestId('place-panel')).toHaveCount(0);
  const after = await modelTablePos(page, '[data-unit-id="0:6"] [data-model="0"]');
  expect(after.x - before.x).toBeGreaterThan(2.5);
  expect(after.x - before.x).toBeLessThan(3.5);
  await expect(page.getByTestId('toast')).toContainText('Dryads moved 3');
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText(/Dryads moved 3(\.\d)?"/);
});

test('an illegal move shows the reason and cannot be confirmed', async ({ page }) => {
  await startGame(page);
  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  await page.locator('[data-action="normal"]').click();
  const scale = await boardScale(page);
  const from = await boardPoint(page);
  await touchDrag(page, from, { x: from.x, y: Math.max(5, from.y - 9 * scale) });
  await expect(page.getByTestId('place-status')).toContainText('Models can move up to 6"');
  await expect(page.getByTestId('place-confirm')).toBeDisabled();
  await expect(page.locator('.ghost.bad').first()).toBeVisible();
  await page.getByTestId('place-cancel').click();
  await expect(page.getByTestId('place-panel')).toHaveCount(0);
});

test('a single model can be adjusted', async ({ page }) => {
  await startGame(page);
  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  await page.locator('[data-action="normal"]').click();
  await page.getByRole('button', { name: 'Adjust' }).click();
  await expect(page.getByRole('button', { name: 'Adjust' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const others = await modelTablePos(page, '[data-ghost-model="1"]');
  const before = await modelTablePos(page, '[data-ghost-model="0"]');
  const start = await modelCentre(page, '0:6', 0, true);
  const scale = await boardScale(page);
  await touchDrag(page, start, { x: start.x, y: start.y - 0.5 * scale });
  const after = await modelTablePos(page, '[data-ghost-model="0"]');
  expect(after.x - before.x).toBeGreaterThan(0.3);
  expect(await modelTablePos(page, '[data-ghost-model="1"]')).toEqual(others);
  await expect(page.locator('[data-ghost-model="0"]')).toHaveClass(/active/);
});

test('pinch-zoom and the zoom buttons change the scale', async ({ page }) => {
  await startGame(page);
  const s0 = await boardScale(page);
  await pinch(page, await boardPoint(page), 80, 240);
  const s1 = await boardScale(page);
  expect(s1).toBeGreaterThan(s0 * 2);
  // One finger pans without zooming.
  const p = await boardPoint(page);
  const anchor = await modelCentre(page, '0:0', 0);
  await touchDrag(page, p, { x: p.x + 60, y: p.y + 40 });
  const moved = await modelCentre(page, '0:0', 0);
  expect(moved.x - anchor.x).toBeCloseTo(60, -1);
  expect(await boardScale(page)).toBeCloseTo(s1, 3);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => boardScale(page)).toBeLessThan(s1);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => boardScale(page)).toBeGreaterThan(s1);
  await page.getByRole('button', { name: 'Show whole table' }).click();
  await expect.poll(() => boardScale(page)).toBeCloseTo(s0, 1);
});

test('passing every phase reaches battle round 2', async ({ page }) => {
  await startGame(page);
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('end-phase').click();
    const ok = page.getByTestId('confirm-ok');
    if (await ok.isVisible()) await ok.click();
  }
  // The opponent passes through its turn on its own.
  await expect(page.getByTestId('round')).toContainText('Round 2', { timeout: 10_000 });
  await expect(page.getByTestId('turn')).toHaveText('Your turn');
});

test('reloading the page resumes the same game', async ({ page }) => {
  await page.goto('./?seed=11&side=0&fast=1');
  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:7');
  await page.locator('[data-action="normal"]').click();
  const scale = await boardScale(page);
  const from = await boardPoint(page);
  await touchDrag(page, from, { x: from.x, y: from.y - 2 * scale });
  await page.getByTestId('place-confirm').click();
  const moved = await modelTablePos(page, '[data-unit-id="0:7"] [data-model="0"]');
  await page.reload();
  await expect(page.getByTestId('phase').locator('[aria-current="step"]')).toHaveText('Movement');
  expect(await modelTablePos(page, '[data-unit-id="0:7"] [data-model="0"]')).toEqual(moved);
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText('Dryads moved 2');
});

test('playing as Seraphon puts their army at the bottom', async ({ page }) => {
  await startGame(page, 'seed=3&side=1&fast=1&new=1');
  const ours = await modelCentre(page, '1:5', 0);
  const theirs = await modelCentre(page, '0:6', 0);
  expect(ours.y).toBeGreaterThan(theirs.y);
  // The opponent (Sylvaneth) takes the first turn and passes it to us.
  await expect(page.getByTestId('turn')).toHaveText('Your turn', { timeout: 10_000 });
});

test('undo reverts a move that rolled no dice', async ({ page }) => {
  await startGame(page);
  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  const before = await modelTablePos(page, '[data-unit-id="0:6"] [data-model="0"]');
  await page.locator('[data-action="normal"]').click();
  const scale = await boardScale(page);
  const from = await boardPoint(page);
  await touchDrag(page, from, { x: from.x, y: from.y - 2 * scale });
  await page.getByTestId('place-confirm').click();
  await page.getByRole('button', { name: 'Undo' }).click();
  // Back to placing the unit, which is where it started.
  await expect(page.getByTestId('place-panel')).toBeVisible();
  expect(await modelTablePos(page, '[data-unit-id="0:6"] [data-model="0"]')).toEqual(before);
});

test('ending a movement phase with nothing moved asks first', async ({ page }) => {
  await startGame(page);
  await page.getByTestId('end-phase').click();
  await expect(page.getByTestId('phase').locator('[aria-current="step"]')).toHaveText('Movement');
  await page.getByTestId('end-phase').click();
  await expect(page.getByTestId('confirm')).toContainText('No unit has moved');
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect(page.getByTestId('phase').locator('[aria-current="step"]')).toHaveText('Movement');
  await page.getByTestId('end-phase').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('phase').locator('[aria-current="step"]')).toHaveText('Shooting');
});
