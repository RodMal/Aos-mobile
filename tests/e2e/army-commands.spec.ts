/**
 * B8: The Goddess Of Life and The Land Awakens are found in the decision panel ("Commands"),
 * without opening a unit's card, and name the destroyed unit.
 */
import { expect, test } from '@playwright/test';
import { openPosition } from './positions.js';

for (const [command, label, phase] of [
  ['goddessOfLife', 'The Goddess Of Life', 'movement'],
  ['landAwakens', 'The Land Awakens', 'end'],
] as const) {
  test(`${label} is offered as an army command`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const stop = `(e, s, d) => {
      if (d.kind !== 'main' || d.player !== 0 || d.phase !== '${phase}') return null;
      for (const u of Object.values(s.units)) {
        if (u.owner !== 0) continue;
        const o = e.unitOptions(s, u.id).find((x) => x.t === 'command' && x.command === '${command}');
        if (o) return o.targets[0];
      }
      return null;
    }`;
    const pos = await openPosition(page, 5, new Function(`return ${stop}`)() as never);
    const name = pos.state.units[pos.note]!.name;
    const panel = page.getByTestId('army-commands');
    await expect(panel).toBeVisible();
    const button = panel.locator(`[data-army-command="${command}"]`);
    await expect(button).toContainText(label);
    await expect(button).toContainText(name);
    await page.screenshot({ path: info.outputPath(`army-commands-${command}.png`) });
    await button.click();
    await expect(page.getByTestId('ability-panel')).toBeVisible();
  });
}
