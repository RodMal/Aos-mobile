/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from '@playwright/test';
import { startGame } from './helpers.js';

test('dbg', async ({ page }) => {
  await startGame(page, 'e2e=1&seed=5&side=0&fast=1&new=1');
  const out = await page.evaluate(() => {
    const { game, engine } = (window as any).__aosTest;
    const state = structuredClone(game.getState().session.state);
    const enemies = Object.values(state.units).filter(
      (u: any) => u.owner === 1 && u.status === 'battlefield' && !u.isManifestation,
    ) as any[];
    return enemies.map((e) => [e.id, e.name, e.models.length, e.models[0]]);
    void engine;
  });
  throw new Error(JSON.stringify(out));
});
