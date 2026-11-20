/**
 * Faction terrain abilities (task M4m, owner ruling I74): Vengeful Forest Spirits (Awakened
 * Wyldwood), Fierce Guardians and Power Unleashed (Realmshaper Engine). The terrain still never
 * moves or fights; it acts through these abilities only. Printed text is in data/factions/
 * sylvaneth.json and seraphon.json; readings in docs/RULES-DECISIONS.md I113.
 */
import type { TerrainFeature } from '../data/battlefield.js';
import { footprintDistanceToPolygon } from '../geom/index.js';
import type { Modifier } from '../rules/core/modifiers.js';
import { abilitiesOf } from './abilities/effects.js';
import { rollD3, illegal, type Ctx } from './ctx.js';
import { inflictMortalDamage } from './damage.js';
import {
  COMBAT_RANGE,
  enemiesWithin,
  hasKeyword,
  isFactionTerrainUnit,
  opponent,
  profileOf,
  unitFootprints,
  unitsOf,
  unitsWithin,
} from './query.js';
import type { Action, GameState, Scenario, UnitId, UnitOption, UnitState } from './types.js';

export const VENGEFUL_FOREST_SPIRITS_ID = '5dd6-a023-8cdb-5cb1';
export const FIERCE_GUARDIANS_ID = 'bf4d-2061-b8d1-193';
export const POWER_UNLEASHED_ID = 'aa75-204a-4256-8c68';

export const FIERCE_GUARDIANS_RANGE = 9;
export const POWER_UNLEASHED_FEATURE_RANGE = 24;
export const POWER_UNLEASHED_MAX_TARGETS = 3;

const has = (scenario: Scenario, unit: UnitState, id: string): boolean =>
  abilitiesOf(scenario, unit).some((a) => a.id === id);

const isTerrainOnBoard = (scenario: Scenario, unit: UnitState): boolean =>
  unit.status === 'battlefield' && isFactionTerrainUnit(scenario, unit);

/** Enemy units a faction terrain ability may name (never other faction terrain). */
const targetable = (scenario: Scenario, u: UnitState): boolean =>
  u.status === 'battlefield' && !isFactionTerrainUnit(scenario, u);

// ─── Vengeful Forest Spirits ────────────────────────────────────────────────────

/**
 * Vengeful Forest Spirits: "Once Per Turn (Army), Any Combat Phase" (a start-of-combat ability,
 * Core 13.1). Every enemy unit within 3" is a target; empty when it cannot be used.
 */
export function vengefulTargets(scenario: Scenario, state: GameState, unit: UnitState): UnitId[] {
  if (state.phase !== 'combat' || !isTerrainOnBoard(scenario, unit)) return [];
  if (!has(scenario, unit, VENGEFUL_FOREST_SPIRITS_ID)) return [];
  if ((state.players[unit.owner].usedOncePerTurn ?? []).includes(VENGEFUL_FOREST_SPIRITS_ID)) {
    return [];
  }
  return enemiesWithin(scenario, state, unit, COMBAT_RANGE)
    .filter((e) => targetable(scenario, e))
    .map((e) => e.id);
}

/** A D3 for each target; on 2+ that much mortal damage. */
export function vengefulForestSpirits(ctx: Ctx, unit: UnitState, targets: UnitState[]): void {
  const p = ctx.s.players[unit.owner];
  p.usedOncePerTurn = [...(p.usedOncePerTurn ?? []), VENGEFUL_FOREST_SPIRITS_ID];
  for (const target of targets) {
    const die = rollD3(ctx, unit.owner, 'Vengeful Forest Spirits');
    if (die >= 2) inflictMortalDamage(ctx, target, die, 'Vengeful Forest Spirits');
  }
}

// ─── Fierce Guardians ───────────────────────────────────────────────────────────

/**
 * Fierce Guardians: +1 to hit for combat attacks by friendly Saurus or Kroxigor units that
 * target an enemy unit within 9" of the terrain. Called for each attack; reads only the
 * attacker's own faction terrain.
 */
export function fierceGuardiansModifiers(
  terrain: UnitState,
  attacker: UnitState,
  target: UnitState,
  scenario: Scenario,
): Modifier[] {
  if (terrain.status !== 'battlefield' || terrain.owner !== attacker.owner) return [];
  if (!hasKeyword(scenario, attacker, 'SAURUS') && !hasKeyword(scenario, attacker, 'KROXIGOR')) {
    return [];
  }
  return unitsWithin(scenario, terrain, target, FIERCE_GUARDIANS_RANGE)
    ? [{ stat: 'hit', value: 1, source: 'Fierce Guardians' }]
    : [];
}

// ─── Power Unleashed ────────────────────────────────────────────────────────────

export interface PowerGroup {
  /** The picked terrain feature: a board feature id or a faction terrain unit id. */
  feature: string;
  targets: UnitId[];
}

/**
 * The terrain features within 24" of the Realmshaper Engine (board terrain and other faction
 * terrain), each with the enemy units within 3" of it. Empty when nothing can be targeted.
 */
export function powerGroups(scenario: Scenario, state: GameState, unit: UnitState): PowerGroup[] {
  const mine = unitFootprints(scenario, unit);
  const enemies = unitsOf(state, opponent(unit.owner)).filter((e) => targetable(scenario, e));
  if (enemies.length === 0) return [];
  const out: PowerGroup[] = [];
  const nearBoard = (t: TerrainFeature): UnitId[] =>
    enemies
      .filter((e) =>
        unitFootprints(scenario, e).some(
          (fp) => footprintDistanceToPolygon(fp, t.polygon) <= COMBAT_RANGE + 1e-6,
        ),
      )
      .map((e) => e.id);
  for (const t of scenario.battlefield.terrain) {
    if (
      !mine.some(
        (fp) => footprintDistanceToPolygon(fp, t.polygon) <= POWER_UNLEASHED_FEATURE_RANGE + 1e-6,
      )
    ) {
      continue;
    }
    const targets = nearBoard(t);
    if (targets.length > 0) out.push({ feature: t.id, targets });
  }
  for (const other of state.unitOrder.map((id) => state.units[id]!)) {
    if (other.id === unit.id || !isTerrainOnBoard(scenario, other)) continue;
    if (!unitsWithin(scenario, unit, other, POWER_UNLEASHED_FEATURE_RANGE)) continue;
    const targets = enemies
      .filter((e) => unitsWithin(scenario, other, e, COMBAT_RANGE))
      .map((e) => e.id);
    if (targets.length > 0) out.push({ feature: other.id, targets });
  }
  return out;
}

/** Power Unleashed: "Your Hero Phase", needs a friendly Seraphon Wizard within 3" of the engine. */
export function powerUnleashedOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  if (state.phase !== 'hero' || state.active !== unit.owner || state.stack.length > 0) return [];
  if (!isTerrainOnBoard(scenario, unit) || !has(scenario, unit, POWER_UNLEASHED_ID)) return [];
  if ((unit.abilitiesUsed ?? []).includes(POWER_UNLEASHED_ID)) return [];
  const wizard = unitsOf(state, unit.owner).some(
    (u) =>
      u.status === 'battlefield' &&
      !isFactionTerrainUnit(scenario, u) &&
      hasKeyword(scenario, u, 'SERAPHON') &&
      (profileOf(scenario, u).wizard ?? 0) > 0 &&
      unitsWithin(scenario, unit, u, COMBAT_RANGE),
  );
  if (!wizard) return [];
  const groups = powerGroups(scenario, state, unit);
  if (groups.length === 0) return [];
  return [
    {
      t: 'ability',
      abilityId: POWER_UNLEASHED_ID,
      name: 'Power Unleashed',
      kind: 'activated',
      targets: [...new Set(groups.flatMap((g) => g.targets))],
      maxTargets: POWER_UNLEASHED_MAX_TARGETS,
    },
  ];
}

/** Uses Power Unleashed: the targets must all be within 3" of one feature within 24". */
export function usePowerUnleashed(ctx: Ctx, action: Extract<Action, { t: 'ability' }>): void {
  const { s, scenario } = ctx;
  const unit = s.units[action.unit];
  if (!unit || powerUnleashedOptions(scenario, s, unit).length === 0) {
    illegal('Power Unleashed cannot be used now.');
  }
  const ids = action.targets ?? (action.target ? [action.target] : []);
  if (ids.length < 1 || ids.length > POWER_UNLEASHED_MAX_TARGETS) {
    illegal(`Power Unleashed takes 1 to ${POWER_UNLEASHED_MAX_TARGETS} targets.`);
  }
  if (new Set(ids).size !== ids.length) illegal('Each target can be picked only once.');
  const group = powerGroups(scenario, s, unit).find((g) =>
    ids.every((id) => g.targets.includes(id)),
  );
  if (!group) {
    illegal(
      'Power Unleashed: the targets must all be within 3" of one terrain feature within 24".',
    );
  }
  unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), POWER_UNLEASHED_ID];
  for (const id of ids) {
    const target = s.units[id]!;
    const die = rollD3(ctx, unit.owner, 'Power Unleashed');
    if (die >= 2) inflictMortalDamage(ctx, target, die, 'Power Unleashed');
  }
  // "If that terrain feature has a Health characteristic": board terrain has none; a faction
  // terrain piece does when its warscroll prints one.
  const feature = s.units[group.feature];
  if (feature && profileOf(scenario, feature).health > 0) {
    inflictMortalDamage(
      ctx,
      feature,
      rollD3(ctx, unit.owner, 'Power Unleashed (terrain)'),
      'Power Unleashed',
    );
  }
}
