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
