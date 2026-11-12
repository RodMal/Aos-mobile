/** Fury and rage: Eruption of Fury's choices in the ability panel. */
import { expect, test } from '@playwright/test';
import { selectFromRoster } from './helpers.js';
import { openPosition } from './positions.js';

test('Eruption of Fury: choose how many rage dice and the target, then spend them', async ({
  page,
}, info) => {
  const position = await openPosition(page, 5, (engine, s, d) => {
    if (d.kind !== 'main' || d.player !== 0 || d.phase !== 'end') return null;
    if ((s.players[0].rageDice ?? 0) < 2) return null;
    const unit = Object.values(s.units).find(
      (u) =>
        u.owner === 0 &&
        engine
          .unitOptions(s, u.id)
          .some((o) => o.t === 'ability' && o.abilityId === 'eruption-of-fury'),
    );
    return unit ? unit.id : null;
  });
  const rageBefore = position.state.players[0].rageDice ?? 0;
  await expect(page.getByTestId('phase').locator('[aria-current="step"]')).toHaveText('End');
  await selectFromRoster(page, position.note);
  await page.locator('[data-ability="eruption-of-fury"]').click();
  const panel = page.getByTestId('ability-panel');
  await expect(panel.getByTestId('rage-dice')).toHaveText(String(Math.min(3, rageBefore)));
  const fewer = panel.getByRole('button', { name: 'Fewer rage dice' });
  while (((await panel.getByTestId('rage-dice').textContent()) ?? '') !== '1') await fewer.click();
  await expect(fewer).toBeDisabled();
  await panel.locator('[data-target]').last().click();
  await page.screenshot({ path: info.outputPath(`eruption-${info.project.name}.png`) });
  await panel.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('fury-you')).toContainText(`${rageBefore - 1}R`);
});

test('Fight Through the Pain: the prompt shows the incoming damage and spends rage dice', async ({
  page,
}, info) => {
  const position = await openPosition(page, 5, (_engine, _s, d) => {
    if (d.kind !== 'reaction' || d.player !== 0) return null;
    const pain = d.options.find((o) => o.ability === 'fightThroughThePain');
    return pain ? `${pain.damage ?? 0}` : null;
  });
  const rageBefore = position.state.players[0].rageDice ?? 0;
  const prompt = page.getByTestId('reaction');
  await expect(prompt).toContainText('Fight Through the Pain');
  await expect(page.getByTestId('pain-damage')).toContainText(`${position.note} damage`);
  await page.screenshot({ path: info.outputPath(`pain-${info.project.name}.png`) });
  const dice = Number(await page.getByTestId('pain-dice').textContent());
  await page.getByTestId('pain-spend').click();
  await expect(page.getByTestId('fury-you')).toContainText(`${rageBefore - dice}R`);
});

test('Place of Power: offered at the start of a turn and answered with a boon', async ({
  page,
}, info) => {
  await openPosition(page, 1, (_engine, _s, d) =>
    d.kind === 'placeOfPower' && d.player === 0 ? d.hero : null,
  );
  const prompt = page.getByTestId('place-of-power');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('start of the');
  await page.screenshot({ path: info.outputPath(`place-of-power-${info.project.name}.png`) });
  await prompt.getByRole('button', { name: /Ignite Fury/ }).click();
  await expect(prompt).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText('Place of Power');
});

test('Creeping Dread: pick an enemy unit in the overgrowth at the start of a turn', async ({
  page,
}, info) => {
  await openPosition(page, 1, (_engine, _s, d) =>
    d.kind === 'creepingDread' && d.player === 0 ? d.units[0]! : null,
  );
  const prompt = page.getByTestId('creeping-dread');
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId('dread-use')).toBeDisabled();
  await prompt.locator('[data-dread]').first().click();
  await page.screenshot({ path: info.outputPath(`creeping-dread-${info.project.name}.png`) });
  await page.getByTestId('dread-use').click();
  await expect(prompt).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText('Creeping Dread');
});
