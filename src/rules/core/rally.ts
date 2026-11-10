/**
 * The Rally command's arithmetic (GHB 2026-27, Commands 2026-27, 2.0): 6 rally rolls, each
 * 4+ is a rally point; 1 point heals 1 damage, Health points return a slain model. Ported
 * from aos-webapp `rules/rally.ts`. The engine spends the points automatically, returning
 * models first.
 */
export const RALLY_ROLLS = 6;
export const RALLY_TARGET = 4;

export function rallyPoints(dice: readonly number[]): number {
  return dice.filter((d) => d >= RALLY_TARGET).length;
}

export interface RallySpend {
  returnModels: number;
  heal: number;
}

/**
 * Returns as many slain models as the points buy, then heals the damage pool with the rest.
 * `slain` is how many models can come back (slain and with room to be set up).
 */
export function rallySpend(points: number, health: number, slain: number, damage: number): RallySpend {
  const returnModels = health > 0 ? Math.min(slain, Math.floor(points / health)) : 0;
  const left = points - returnModels * health;
  return { returnModels, heal: Math.min(left, damage) };
}
