/**
 * Sylvaneth Faction Battle Traits & Warscroll Rules (Core Rules & BSData).
 *
 * Implements:
 * 1. The Creeping Overgrowth (battle-traits-sylvaneth_bf2f-f70a-be1e-4d63)
 *    Measured from each terrain feature that has a friendly overgrown token.
 *    - 0-2 overgrown tokens: 6"
 *    - 3-5 overgrown tokens: 9"
 *    - 6-8 overgrown tokens: 12"
 *    - 9+ overgrown tokens: Whole battlefield
 * 2. Awakened Wyldwood (faction terrain):
 *    - Carries an overgrown token inherently.
 *    - Ever Growing: At the start of each battle round, closest non-overgrown terrain within 6" gains an overgrown token.
 * 3. Creeping Dread (battle-traits-sylvaneth_c9cf-21d7-880d-e59f, Once Per Turn, Start of Any Turn):
 *    Pick an enemy unit within creeping overgrowth: for the rest of the turn, the first time the opponent
 *    declares a command for it while not wholly within 12" of a Hero, it costs 1 additional CP.
 * 4. Endless Growth (battle-traits-sylvaneth_3ff5-8812-c55e-7f5a, Once Per Turn, End of Any Turn):
 *    Pick each friendly Sylvaneth unit wholly within creeping overgrowth: roll D3.
 *    - Nature's Titans (Lords of the Clan formation): Monster targets heal 3 instead of rolling.
 *    - Non-monsters: heal roll or return slain models up to roll value.
 * 5. Seasons Of War (Alarielle, alarielle-the-everqueen_d584-62b7-8083-8f63, Start of Battle Round):
 *    Pick 1 effect for the round (cannot pick same as previous round):
 *    - The Burgeoning
 *    - The Reaping: +1 cast/chant for friendly Sylvaneth wholly within 12" of Alarielle
 *    - The Dwindling: Friendly Sylvaneth can charge after retreat, no retreat mortal damage
 *    - Everdusk: Creeping Dread can pick up to 3 targets
 */
import type { Ctx } from '../../engine/ctx.js';
import { unitWithinTerrain } from '../../engine/terrain.js';
import { hasEffectiveKeyword } from '../../engine/abilities/effects.js';
import { returnPosition } from '../../engine/damage.js';
import { modelFootprint, opponent, profileOf, unitsOf } from '../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitState } from '../../engine/types.js';
import type { TerrainFeature } from '../../data/battlefield.js';

export const CREEPING_DREAD_EFFECT_ID = 'sylvaneth:creeping-dread';
/** BSData ids. */
export const ENDLESS_GROWTH_ID = '3ff5-8812-c55e-7f5a';
export const CREEPING_DREAD_ID = 'c9cf-21d7-880d-e59f';
export const CREEPING_OVERGROWTH_ID = 'bf2f-f70a-be1e-4d63';
export const NATURES_TITANS_ID = '470d-dce9-5e70-29fb';
export const EVER_GROWING_ID = '8c86-1655-c6c7-be0b';
export const SEASONS_OF_WAR_ID = 'd584-62b7-8083-8f63';
export const ALARIELLE_SEASONS = ['burgeoning', 'reaping', 'dwindling', 'everdusk'] as const;
export type AlarielleSeason = (typeof ALARIELLE_SEASONS)[number];

/** Calculates the creeping overgrowth aura range based on the count of overgrown tokens. */
export function creepingOvergrowthRange(tokens: number): number {
  if (tokens >= 9) return Infinity;
  if (tokens >= 6) return 12;
  if (tokens >= 3) return 9;
  return 6;
}

/** Returns the terrain feature IDs that currently count as overgrown for `player`. */
export function playerOvergrownTerrainIds(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): string[] {
  const ids: string[] = [];
  // Faction terrain (Awakened Wyldwoods deployed on table)
  for (const u of unitsOf(state, player)) {
    if (u.status === 'battlefield' && profileOf(scenario, u).isFactionTerrain) {
      ids.push(u.id);
    }
  }
  // Battlefield terrain features marked with overgrown tokens
  for (const tid of state.overgrownTerrain ?? []) {
    if (!ids.includes(tid)) ids.push(tid);
  }
  return ids;
}

/**
 * Checks whether `unit` is within the creeping overgrowth of `player`.
 * Range is measured from any friendly Awakened Wyldwood or overgrown terrain feature.
 */
export function isWithinCreepingOvergrowth(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  player: PlayerId,
  whollyWithin = false,
): boolean {
  if (unit.status !== 'battlefield') return false;
  const overgrownIds = playerOvergrownTerrainIds(scenario, state, player);
  if (overgrownIds.length === 0) return false;

  const range = creepingOvergrowthRange(overgrownIds.length);
  if (range === Infinity) return true;

  // Check distance to battlefield terrain features marked overgrown
  for (const t of scenario.battlefield.terrain) {
    if (!overgrownIds.includes(t.id)) continue;
    if (unitWithinTerrain(scenario, unit, t, range, whollyWithin)) {
      return true;
    }
  }

  // Check distance to Awakened Wyldwoods (deployed faction terrain units)
  for (const u of unitsOf(state, player)) {
    if (!overgrownIds.includes(u.id)) continue;
    // Model-to-model distance to the Wyldwood base
    for (let i1 = 0; i1 < u.models.length; i1++) {
      const m1 = u.models[i1]!;
      const fp1 = modelFootprint(scenario, u, i1, m1);
      const inRange = unit.models.some((m2, i2) => {
        const fp2 = modelFootprint(scenario, unit, i2, m2);
        const dist =
          Math.hypot(fp1.cx - fp2.cx, fp1.cy - fp2.cy) -
          (fp1.kind === 'circle' ? fp1.r : 2) -
          (fp2.kind === 'circle' ? fp2.r : 1);
        return dist <= range;
      });
      if (inRange) return true;
    }
  }

  return false;
}

/**
 * Awakened Wyldwood: Ever Growing
 * At start of battle round, the closest terrain feature within 6" of an Awakened Wyldwood
 * that is not already overgrown gains an overgrown token.
 */
export function applyEverGrowing(scenario: Scenario, state: GameState): void {
  const overgrown = new Set<string>(state.overgrownTerrain ?? []);
  for (const u of Object.values(state.units)) {
    if (u.status !== 'battlefield' || !profileOf(scenario, u).isFactionTerrain) continue;
    const candidates = scenario.battlefield.terrain.filter((t) => !overgrown.has(t.id));
    let closest: TerrainFeature | null = null;
    for (const t of candidates) {
      if (unitWithinTerrain(scenario, u, t, 6, false)) {
        closest = t;
        break;
      }
    }
    if (closest) {
      overgrown.add(closest.id);
    }
  }
  state.overgrownTerrain = [...overgrown];
}

/**
 * Returns eligible enemy targets for Creeping Dread (within creeping overgrowth).
 */
export function creepingDreadTargets(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  const opp = opponent(player);
  return unitsOf(state, opp).filter(
    (u) =>
      u.status === 'battlefield' && isWithinCreepingOvergrowth(scenario, state, u, player, false),
  );
}

/**
 * Applies Creeping Dread to target unit for the turn.
 */
export function applyCreepingDread(ctx: Ctx, target: UnitState, heroWhollyWithinRange = 12): void {
  ctx.events.push({
    t: 'note',
    text: `Creeping Dread affects ${target.name}: commands outside 12" of a Hero cost +1 CP.`,
  });
  ctx.s.effects = [
    ...(ctx.s.effects ?? []),
    {
      id: CREEPING_DREAD_EFFECT_ID,
      name: 'Creeping Dread',
      sourceUnit: target.id,
      targetUnit: target.id,
      owner: target.owner,
      expires: 'turn',
      data: {
        extraCpCost: 1,
        heroWhollyWithinRange,
      },
    },
  ];
}

/** True when `player`'s army has the battle trait with BSData id `abilityId`. */
export function armyHasBattleTrait(scenario: Scenario, player: PlayerId, abilityId: string) {
  return scenario.armies[player].battleTraits.some((a) => a.id === abilityId);
}

/** True when `player`'s battle formation has the ability with BSData id `abilityId`. */
export function armyHasFormationAbility(scenario: Scenario, player: PlayerId, abilityId: string) {
  return scenario.armies[player].formation.abilities.some((a) => a.id === abilityId);
}

/**
 * Endless Growth (Once Per Turn (Army), End of Any Turn): "Pick each friendly SYLVANETH unit
 * that is wholly within the creeping overgrowth to be the targets. For each target, roll a D3
 * and pick 1 of the following effects: Heal (X) the target, where X is equal to the roll; or
 * return a number of slain models to it with a combined Health characteristic of up to the
 * value of the roll."
 *
 * Nature's Titans (Lords of the Clan): "do not roll a D3 for MONSTER targets. Instead Heal (3)
 * each of those targets."
 *
 * Runs at the end of every turn for each army that has the trait. The engine picks the effect
 * (S7): returning models when at least one slain model fits in the roll (a returned model is
 * always worth more than the damage on one model), otherwise healing. Faction terrain is a
 * terrain feature, not a unit to heal, so it is not a target. Units with nothing to restore are
 * skipped without rolling.
 */
export function resolveEndlessGrowth(ctx: Ctx, player: PlayerId): void {
  const { scenario, s } = ctx;
  if (!armyHasBattleTrait(scenario, player, ENDLESS_GROWTH_ID)) return;
  const titans = armyHasFormationAbility(scenario, player, NATURES_TITANS_ID);

  const targets = unitsOf(s, player).filter((u) => {
    const p = profileOf(scenario, u);
    if (p.isFactionTerrain) return false;
    if (!hasEffectiveKeyword(scenario, s, u, 'SYLVANETH')) return false;
    return isWithinCreepingOvergrowth(scenario, s, u, player, true);
  });

  for (const u of targets) {
    const slain = u.models.flatMap((m, i) => (m.alive ? [] : [i]));
    if (u.damage === 0 && slain.length === 0) continue;
    const health = profileOf(scenario, u).health;
    if (titans && hasEffectiveKeyword(scenario, s, u, 'MONSTER')) {
      const healed = Math.min(u.damage, 3);
      u.damage -= healed;
      ctx.events.push({
        t: 'note',
        text: `Endless Growth (Nature's Titans): ${u.name} heals ${healed}.`,
      });
      continue;
    }
    const roll = ctx.rng.int(1, 3);
    ctx.events.push({ t: 'roll', player, label: `Endless Growth (${u.name})`, dice: [roll] });
    let returned = 0;
    for (const i of slain.slice(0, Math.floor(roll / health))) {
      const at = returnPosition(scenario, s, u, i);
      if (!at) break;
      Object.assign(u.models[i]!, at, { alive: true });
      returned++;
    }
    if (returned > 0) {
      ctx.events.push({
        t: 'note',
        text: `Endless Growth: ${returned} slain model(s) return to ${u.name}.`,
      });
      continue;
    }
    const healed = Math.min(u.damage, roll);
    u.damage -= healed;
    ctx.events.push({ t: 'note', text: `Endless Growth: ${u.name} heals ${healed}.` });
  }
}
