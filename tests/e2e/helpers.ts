/** Touch helpers for the e2e tests: real touch input through the Chrome DevTools Protocol. */
import { expect, type CDPSession, type Page } from '@playwright/test';

export interface P {
  x: number;
  y: number;
}

const sessions = new WeakMap<Page, CDPSession>();

async function cdp(page: Page): Promise<CDPSession> {
  let s = sessions.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    sessions.set(page, s);
  }
  return s;
}

async function touch(
  page: Page,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: P[],
): Promise<void> {
  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
  });
}

/** A one-finger drag from `from` to `to` in `steps` moves. */
export async function touchDrag(page: Page, from: P, to: P, steps = 12): Promise<void> {
  await touch(page, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touch(page, 'touchMove', [
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
    ]);
    await page.waitForTimeout(16);
  }
  await touch(page, 'touchEnd', []);
  await page.waitForTimeout(50);
}

/** A two-finger pinch around `centre`, from `startGap` to `endGap` pixels apart. */
export async function pinch(page: Page, centre: P, startGap: number, endGap: number, steps = 10) {
  const pts = (gap: number): P[] => [
    { x: centre.x - gap / 2, y: centre.y },
    { x: centre.x + gap / 2, y: centre.y },
  ];
  await touch(page, 'touchStart', pts(startGap));
  for (let i = 1; i <= steps; i++) {
    await touch(page, 'touchMove', pts(startGap + ((endGap - startGap) * i) / steps));
    await page.waitForTimeout(16);
  }
  await touch(page, 'touchEnd', []);
  await page.waitForTimeout(50);
}

export async function boardScale(page: Page): Promise<number> {
  return Number(await page.getByTestId('board').getAttribute('data-scale'));
}

/** Screen centre of a model of a unit. */
export async function modelCentre(
  page: Page,
  unit: string,
  model: number,
  ghost = false,
): Promise<P> {
  const sel = ghost
    ? `[data-ghost-model="${model}"]`
    : `[data-unit-id="${unit}"] [data-model="${model}"]`;
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error(`no model ${unit}#${model}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Table position of a model, read from its SVG attributes. */
export async function modelTablePos(page: Page, sel: string): Promise<P> {
  const el = page.locator(sel);
  const tag = await el.evaluate((e) => e.tagName);
  if (tag === 'rect') {
    const [x, y, w, h] = await Promise.all(
      ['x', 'y', 'width', 'height'].map((a) => el.getAttribute(a)),
    );
    return { x: Number(x) + Number(w) / 2, y: Number(y) + Number(h) / 2 };
  }
  const [cx, cy] = await Promise.all([el.getAttribute('cx'), el.getAttribute('cy')]);
  return { x: Number(cx), y: Number(cy) };
}

export async function startGame(page: Page, query = 'seed=5&side=0&fast=1&new=1'): Promise<void> {
  await page.goto(`./?${query}`);
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('[data-unit-id] [data-model]').first()).toBeVisible();
}

/** Ends the human's phases until the given phase (current phase label) shows. */
export async function endPhaseUntil(page: Page, phase: RegExp): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (
      phase.test(
        (await page.getByTestId('phase').locator('[aria-current="step"]').textContent()) ?? '',
      )
    )
      return;
    const card = page.getByTestId('unit-panel');
    if (await card.isVisible()) await card.getByRole('button', { name: 'Close' }).click();
    await page.getByTestId('end-phase').click();
    const ok = page.getByTestId('confirm-ok');
    if (await ok.isVisible()) await ok.click();
  }
  throw new Error(`never reached ${phase}`);
}

/** Selects a unit through the roster drawer. */
export async function selectFromRoster(page: Page, unit: string): Promise<void> {
  await page.getByRole('button', { name: 'Roster' }).click();
  await page.locator(`[data-roster-unit="${unit}"]`).click();
  await expect(page.getByTestId('unit-panel')).toHaveAttribute('data-unit', unit);
}

/** A point on the visible part of the board, away from the floating buttons. */
export async function boardPoint(page: Page): Promise<P> {
  const box = (await page.getByTestId('board').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.3 };
}
