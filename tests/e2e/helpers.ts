/** Touch helpers for the e2e tests: real touch input through the Chrome DevTools Protocol. */
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

export interface P {
  x: number;
  y: number;
}

/** True in the mouse-and-keyboard project; the phone projects use touch. */
export function isDesktop(): boolean {
  return test.info().project.name === 'desktop';
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

/** A one-finger touch drag on the phone projects, a left-button mouse drag on desktop. */
export async function drag(page: Page, from: P, to: P, steps = 12): Promise<void> {
  if (!isDesktop()) return touchDrag(page, from, to, steps);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

/** A tap on the phone projects, a click on desktop. */
export async function tapAt(page: Page, p: P): Promise<void> {
  if (isDesktop()) await page.mouse.click(p.x, p.y);
  else await page.touchscreen.tap(p.x, p.y);
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

/**
 * The screen point `inches` towards the enemy from `from` (for the player on the left or bottom
 * of the table, as in side=0), plus `across` inches to the right of that direction. The phone
 * shows the table turned so the enemy is up the screen; on a wide window it is shown flat with
 * the enemy to the right.
 */
export async function ahead(page: Page, from: P, inches: number, across = 0): Promise<P> {
  const scale = await boardScale(page);
  const flat = (await page.getByTestId('board').getAttribute('data-rot')) === '0';
  const p = flat
    ? { x: from.x + inches * scale, y: from.y + across * scale }
    : { x: from.x + across * scale, y: from.y - inches * scale };
  // The drag may end past the board edge (the pointer is captured) but must stay in the window.
  return { x: Math.max(5, p.x), y: Math.max(5, p.y) };
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
  await answerPreBattle(page);
}

/**
 * Answers the pre-battle prompts a quick-start game opens with (the Burning for Vengeance
 * fugitive, the first-turn choice) with their first option and declines the optional Place of
 * Power, so a test starts in the hero phase.
 */
export async function answerPreBattle(page: Page): Promise<void> {
  // Answer prompts until the player's own hero phase shows (the opponent's own start-of-turn
  // choice comes in between, from the worker). In a game where the opponent goes first this
  // gives up after a few seconds and leaves the rest to the test.
  for (let i = 0; i < 60; i++) {
    if (await answerStartPrompt(page)) continue;
    if (await usable(page.getByTestId('end-phase'))) break;
    await page.waitForTimeout(100);
  }
  // Those answers leave a toast that would catch the next tap on the board; let it go first.
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 6000 });
}

/**
 * While the opponent plays: answers a start-of-turn prompt, skips a reaction or takes the
 * damage instead of Fight Through the Pain. True when it answered something.
 */
export async function answerOpponentTurnPrompt(page: Page): Promise<boolean> {
  if (await answerStartPrompt(page)) return true;
  for (const l of [
    page.getByRole('button', { name: 'Skip', exact: true }),
    page.getByTestId('pain-skip'),
  ]) {
    if (await usable(l)) {
      await l.click();
      return true;
    }
  }
  return false;
}

/**
 * Answers one pre-battle or start-of-turn prompt if one is showing (the fugitive pick, the
 * first-turn choice, the optional Place of Power, declined). True when it answered one.
 */
export async function answerStartPrompt(page: Page): Promise<boolean> {
  const fugitive = page.locator('[data-fugitive]').first();
  const first = page.getByRole('button', { name: 'Take first turn' });
  const power = page.getByTestId('place-of-power').getByRole('button', { name: 'Pass' });
  for (const l of [fugitive, first, power]) {
    if (await usable(l)) {
      await l.click();
      return true;
    }
  }
  return false;
}

/**
 * Starts an alternating-deployment game (`?deploy=1`, the menu's "Alternating deploy"): nothing
 * is on the table yet, and the player is asked to place a unit as soon as it is their turn.
 */
export async function startDeploy(
  page: Page,
  query = 'seed=5&side=0&new=1&deploy=1',
): Promise<void> {
  await page.goto(`./?${query}`);
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('place-panel')).toBeVisible({ timeout: 20_000 });
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
  // On the phone the sheet covers the lower part of the board; on desktop it sits beside it.
  return { x: box.x + box.width / 2, y: box.y + box.height * (isDesktop() ? 0.5 : 0.3) };
}

/** True when a control is on screen and can be clicked. */
export const usable = async (l: Locator): Promise<boolean> =>
  (await l.isVisible().catch(() => false)) && (await l.isEnabled().catch(() => false));

/**
 * One step of a minimal player: ends its own phases, answers the priority roll and the fugitive
 * pick, skips reactions (taking the damage instead of Fight Through the Pain), and fights back when it must. Returns what it clicked, or null if nothing applied.
 */
export async function minimalPlayerStep(page: Page): Promise<string | null> {
  const controls: [string, Locator][] = [
    ['confirm', page.getByTestId('confirm-ok')],
    ['priority', page.getByRole('button', { name: 'Take first turn' })],
    ['fugitive', page.locator('[data-fugitive]').first()],
    ['skip reaction', page.getByRole('button', { name: 'Skip', exact: true })],
    ['take the damage', page.getByTestId('pain-skip')],
    [
      'pass place of power',
      page.getByTestId('place-of-power').getByRole('button', { name: 'Pass' }),
    ],
    ['roll', page.getByTestId('roll-attacks')],
    ['confirm placement', page.getByTestId('place-confirm')],
    ['cancel placement', page.getByTestId('place-cancel')],
    ['fight', page.locator('[data-action="fight"]')],
    ['end phase', page.getByTestId('end-phase')],
    ['pick unit', page.locator('[data-testid="ready-units"] .chip').first()],
    ['close card', page.getByTestId('unit-panel').getByRole('button', { name: 'Close' })],
  ];
  for (const [name, control] of controls) {
    if (await usable(control)) {
      if (name === 'pick unit' && (await usable(page.getByTestId('end-phase')))) continue;
      await control.click({ timeout: 3000 });
      return name;
    }
  }
  return null;
}
