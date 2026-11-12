/** The ability panel: spells, summons, prayers and reactions through the touch UI. */
import { expect, test, type Page } from '@playwright/test';
import {
  isDesktop,
  minimalPlayerStep,
  modelCentre,
  selectFromRoster,
  startGame,
  tapAt,
} from './helpers.js';

const JADE_THORNS = '97df-e136-9fb4-5aca';
const PENDULUM = '678b-96e1-66bb-1de8';
const SONG_OF_WAR = '1b5b-a2e8-6dd3-17fb';

async function openAbility(page: Page, unit: string, abilityId: string) {
  await selectFromRoster(page, unit);
  await page.locator(`[data-ability="${abilityId}"]`).click();
  await expect(page.getByTestId('ability-panel')).toBeVisible();
}

async function logText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Log' }).click();
  const text = (await page.getByTestId('log-list').textContent()) ?? '';
  await page.getByTestId('log').getByRole('button', { name: 'Close' }).click();
  return text;
}

test('a spell shows its printed text, needs a target, and casts at the chosen one', async ({
  page,
}) => {
  await startGame(page);
  await openAbility(page, '0:0', JADE_THORNS);
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toContainText('Jade Thorns');
  await expect(panel).toContainText('Add 1 to the wound rolls');
  // Two Dryads units: the names are numbered.
  await expect(panel.locator('[data-target="0:6"]')).toHaveText('Dryads 1');
  await expect(panel.locator('[data-target="0:7"]')).toHaveText('Dryads 2');
  // The legal targets are marked on the board, and nothing is chosen yet.
  await expect(page.locator('[data-unit-id="0:6"]')).toHaveClass(/target/);
  const confirm = page.getByTestId('ability-confirm');
  await expect(confirm).toBeDisabled();

  await panel.locator('[data-target="0:7"]').click();
  await expect(confirm).toBeEnabled();
  await expect(page.locator('[data-unit-id="0:7"]')).toHaveClass(/assigned/);
  await confirm.click();
  await expect(page.getByTestId('ability-panel')).toHaveCount(0);
  expect(await logText(page)).toMatch(
    /Alarielle the Everqueen (casts|fails to cast|miscasts) Jade Thorns/,
  );
});

test('a target can be chosen by tapping it on the board, and Cancel closes the panel', async ({
  page,
}) => {
  await startGame(page);
  await openAbility(page, '0:0', JADE_THORNS);
  const confirm = page.getByTestId('ability-confirm');
  await expect(confirm).toBeDisabled();
  // Tap the highlighted Dryads on the table (the board is framed on the caster and targets).
  // On the phone the sheet covers the bottom of the board; on desktop it sits to the right.
  const sheetBox = (await page.locator('.sheet-body').boundingBox())!;
  const boardBox = (await page.getByTestId('board').boundingBox())!;
  const bottom = isDesktop() ? boardBox.y + boardBox.height : sheetBox.y;
  const right = isDesktop() ? sheetBox.x : boardBox.x + boardBox.width;
  let at: { x: number; y: number } | null = null;
  for (let m = 0; m < 10 && !at; m++) {
    const c = await modelCentre(page, '0:6', m).catch(() => null);
    if (c && c.y < bottom - 20 && c.y > boardBox.y + 20 && c.x > 60 && c.x < right - 60) at = c;
  }
  expect(at, 'a Dryad is on screen beside the sheet').not.toBeNull();
  await tapAt(page, at!);
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId('ability-panel').locator('[data-target="0:6"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByTestId('ability-cancel').click();
  await expect(page.getByTestId('ability-panel')).toHaveCount(0);
});

test('a summon shows its text, needs no target and rolls the casting roll', async ({ page }) => {
  await startGame(page);
  await openAbility(page, '0:0', PENDULUM);
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toContainText('Set up an Aethervoid Pendulum');
  await expect(panel.getByTestId('ability-targets')).toHaveCount(0);
  await expect(page.getByTestId('ability-confirm')).toBeEnabled();
  await page.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('ability-panel')).toHaveCount(0);
  expect(await logText(page)).toMatch(
    /Alarielle the Everqueen (casts|fails to cast|miscasts) Summon/,
  );
});

test('a priest chants a prayer through the panel', async ({ page }) => {
  await startGame(page);
  await openAbility(page, '0:5', SONG_OF_WAR);
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toContainText('Song Of War');
  await expect(panel).toContainText('Chanting roll');
  await expect(page.getByTestId('ability-confirm')).toBeDisabled();
  await panel.getByTestId('ability-targets').locator('.chip').first().click();
  await page.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('ability-panel')).toHaveCount(0);
  expect(await logText(page)).toMatch(/Warsong Revenant chants Song Of War/);
});

test('the opponent casting offers an Unbind reaction that can be answered', async ({ page }) => {
  test.setTimeout(90_000);
  // With this seed the opponent casts in its hero phase while the player has wizards.
  await startGame(page, 'seed=3&side=0&fast=1&new=1');
  const reaction = page.getByTestId('reaction');
  const unbind = reaction.getByRole('button', { name: /^Unbind/ }).first();
  for (let i = 0; i < 600 && !(await unbind.isVisible()); i++) {
    if (!(await minimalPlayerStep(page))) await page.waitForTimeout(100);
  }
  await expect(reaction).toBeVisible();
  await expect(reaction).toContainText('Unbind?');
  await reaction
    .getByRole('button', { name: /^Unbind/ })
    .first()
    .click();
  // The unbind roll is made at once; any further prompt (a second wizard may try, another
  // spell, end of phase) is skipped before the log is read.
  for (let i = 0; i < 40; i++) {
    if (!(await reaction.isVisible())) {
      try {
        await page.getByRole('button', { name: 'Log' }).click({ timeout: 700 });
        break;
      } catch {
        /* a prompt came up in between: skip it and try again */
      }
    }
    const skip = reaction.getByRole('button', { name: 'Skip', exact: true });
    const takeIt = page.getByTestId('pain-skip');
    if (await skip.isVisible()) await skip.click();
    else if (await takeIt.isVisible()) await takeIt.click();
  }
  const text = (await page.getByTestId('log-list').textContent()) ?? '';
  expect(text).toMatch(/(unbinds|fails to unbind)/);
});
