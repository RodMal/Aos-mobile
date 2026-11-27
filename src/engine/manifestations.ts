/**
 * Manifestation abilities that need the engine (M4l): Mechanisms of Time (Chronomantic Cogs) and
 * the charge re-roll it gives, Bound for the Great Oubliette (Soulsnare Shackles) and Morbid
 * Detonation (Malevolent Maelstrom). Modifiers (Pull of the Nadir, Dancing Blades, Decrease Time
 * Flow) live in `abilities/manifestations.ts`. Printed text is in data/factions/universal.json;
 * readings in docs/RULES-DECISIONS.md S13 and I116 to I118.
 */
import {
  BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
  DETONATION_RANGE,
  hasManifestationAbility,
  MAELSTROM_POINTS_MAX,
  MECHANISMS_AREA,
  MECHANISMS_OF_TIME_ID,
  MECHANISMS_WIZARD_RANGE,
  MORBID_DETONATION_ID,
  OUBLIETTE_RANGE,
  TIME_FLOW_CHOICES,
  type TimeFlow,
} from './abilities/manifestations.js';
import { addEffect } from './abilities/effects.js';
import { d6, illegal, rollD3, type Ctx } from './ctx.js';
import { destroyUnit, inflictMortalDamage } from './damage.js';
import {
  aliveIndices,
  hasKeyword,
  modelFootprint,
  footprintsWithin,
  profileOf,
  unitFootprints,
  unitWhollyWithin,
  unitsOf,
  unitsWithin,
} from './query.js';
import { rollAndPushCharge } from './commands.js';
import type { Action, GameState, Scenario, UnitId, UnitOption, UnitState } from './types.js';

/** The ability actions of these manifestations that are one `ability` action by the unit itself. */
export const MANIFESTATION_ACTIVATED_IDS: readonly string[] = [
  MECHANISMS_OF_TIME_ID,
  BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
];

/** The `ability` action of a charging unit that re-rolls its charge roll (Increase Time Flow). */
export const TIME_FLOW_REROLL_ID = 'time-flow-reroll';

type AbilityAction = Extract<Action, { t: 'ability' }>;

const usableManifestation = (scenario: Scenario, unit: UnitState, id: string): boolean =>
  unit.status === 'battlefield' && hasManifestationAbility(scenario, unit, id);

/** Your own hero phase, nothing else going on: when a unit's own ability can be used. */
const inOwnHeroPhase = (state: GameState, unit: UnitState): boolean =>
  state.phase === 'hero' && state.active === unit.owner && state.stack.length === 0;

// ─── Mechanisms of Time ─────────────────────────────────────────────────────────

/** Friendly Wizards within 3" of the Cogs. */
export function wizardsNearCogs(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitState[] {
  return unitsOf(state, unit.owner).filter(
    (w) =>
      w.id !== unit.id &&
      hasKeyword(scenario, w, 'WIZARD') &&
      unitsWithin(scenario, unit, w, MECHANISMS_WIZARD_RANGE),
  );
}

/**
 * Mechanisms of Time, once per turn in your hero phase when a friendly Wizard is within 3": one
 * option for each of the two effects, so the player picks one (I116).
 */
export function mechanismsOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  if (!usableManifestation(scenario, unit, MECHANISMS_OF_TIME_ID)) return [];
  if (!inOwnHeroPhase(state, unit)) return [];
  if ((unit.abilitiesUsed ?? []).includes(MECHANISMS_OF_TIME_ID)) return [];
  if (wizardsNearCogs(scenario, state, unit).length === 0) return [];
  return (Object.keys(TIME_FLOW_CHOICES) as TimeFlow[]).map((choice) => ({
    t: 'ability',
    abilityId: MECHANISMS_OF_TIME_ID,
    name: TIME_FLOW_CHOICES[choice],
    kind: 'activated',
    choice,
    targets: [],
  }));
}

export function useMechanisms(ctx: Ctx, action: AbilityAction): void {
  const { s, scenario } = ctx;
  const unit = s.units[action.unit];
  if (!unit) illegal('Unknown unit.');
  const option = mechanismsOptions(scenario, s, unit).find(
    (o) => o.t === 'ability' && o.choice === action.choice,
  );
  if (!option || option.t !== 'ability') {
    illegal('Mechanisms of Time: pick Increase Time Flow or Decrease Time Flow, once per turn.');
  }
  const mode = option.choice as TimeFlow;
  unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), MECHANISMS_OF_TIME_ID];
  addEffect(s, {
    id: MECHANISMS_OF_TIME_ID,
    name: TIME_FLOW_CHOICES[mode],
    sourceUnit: unit.id,
    targetUnit: unit.id,
    owner: unit.owner,
    expires: 'startOfNextTurn',
    data: { mode },
  });
  ctx.events.push({
    t: 'note',
    text:
      mode === 'increase'
        ? `${unit.name}: Increase Time Flow. Charge rolls of friendly units wholly within ${MECHANISMS_AREA}" can be re-rolled until your next turn.`
        : `${unit.name}: Decrease Time Flow. -1 to hit rolls against friendly Wizards wholly within ${MECHANISMS_AREA}" until your next turn.`,
  });
}

/**
 * Increase Time Flow: the Cogs of this unit's owner that give the re-roll to `unit`: a charge
 * roll is re-rolled once only, by a unit wholly within 12" of the Cogs.
 */
export function timeFlowReroll(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (unit.status !== 'battlefield' || unit.isManifestation) return false;
  if (!unit.chargeDeclared || unit.charged || unit.chargeRerolled) return false;
  return (state.effects ?? []).some((e) => {
    if (e.id !== MECHANISMS_OF_TIME_ID || e.data?.mode !== 'increase') return false;
    if (e.owner !== unit.owner) return false;
    const cogs = state.units[e.sourceUnit];
    return (
      !!cogs &&
      cogs.status === 'battlefield' &&
      unitWhollyWithin(scenario, cogs, unit, MECHANISMS_AREA)
    );
  });
}

/** The unit option that re-rolls the charge roll, when it can. */
export function timeFlowRerollOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  return timeFlowReroll(scenario, state, unit)
    ? [
        {
          t: 'ability',
          abilityId: TIME_FLOW_REROLL_ID,
          name: 'Re-roll the charge (Increase Time Flow)',
          kind: 'activated',
          targets: [],
        },
      ]
    : [];
}

/**
 * Re-rolls the charge roll of `unitId` (the place frame of a successful roll is taken back first,
 * as Forward to Victory does).
 */
export function rerollCharge(ctx: Ctx, unitId: UnitId): void {
  const { s, scenario } = ctx;
  const unit = s.units[unitId];
  if (!unit || !timeFlowReroll(scenario, s, unit)) {
    illegal('That unit cannot re-roll its charge roll now.');
  }
  unit.chargeRerolled = true;
  const top = s.stack[s.stack.length - 1];
  if (top?.t === 'place' && top.unit === unitId && top.reason === 'charge') s.stack.pop();
  ctx.events.push({
    t: 'note',
    text: `${unit.name} re-rolls its charge roll (Increase Time Flow).`,
  });
  rollAndPushCharge(ctx, unit);
}

// ─── Bound for the Great Oubliette ──────────────────────────────────────────────

/** Used once per phase: the hero phases of two turns never share the per-turn record. */
const oublietteUsed = (unit: UnitState): boolean =>
  (unit.abilitiesUsed ?? []).includes(BOUND_FOR_THE_GREAT_OUBLIETTE_ID);

/** Enemy units within 3" of each living part of the manifestation, not yet picked this turn. */
export function oubliettePartTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitId[][] {
  const taken = unit.oublietteTargets ?? [];
  const enemies = state.unitOrder
    .map((id) => state.units[id]!)
    .filter(
      (e) =>
        e.owner !== unit.owner &&
        e.status === 'battlefield' &&
        !taken.includes(e.id) &&
        !profileOf(scenario, e).isFactionTerrain &&
        aliveIndices(e).length > 0,
    );
  const fps = new Map(enemies.map((e) => [e.id, unitFootprints(scenario, e)]));
  return aliveIndices(unit).map((i) => {
    const part = modelFootprint(scenario, unit, i);
    return enemies
      .filter((e) => footprintsWithin([part], fps.get(e.id)!, OUBLIETTE_RANGE))
      .map((e) => e.id);
  });
}

/** Every unit that some part could pick. */
export function oublietteTargets(scenario: Scenario, state: GameState, unit: UnitState): UnitId[] {
  const seen = new Set<UnitId>();
  for (const part of oubliettePartTargets(scenario, state, unit))
    for (const id of part) seen.add(id);
  return [...seen];
}

/**
 * True when each of `ids` can be given its own part: "for each part, pick an enemy unit within 3"
 * of that part", and the same unit only once.
 */
export function oublietteAssignable(parts: readonly UnitId[][], ids: readonly UnitId[]): boolean {
  if (new Set(ids).size !== ids.length || ids.length > parts.length) return false;
  const used = new Set<number>();
  const assign = (k: number): boolean => {
    if (k === ids.length) return true;
    for (let p = 0; p < parts.length; p++) {
      if (used.has(p) || !parts[p]!.includes(ids[k]!)) continue;
      used.add(p);
      if (assign(k + 1)) return true;
      used.delete(p);
    }
    return false;
  };
  return assign(0);
}

/** The most targets: one for each living part (at least one when it has targets at all). */
export function oublietteMax(scenario: Scenario, state: GameState, unit: UnitState): number {
  const parts = oubliettePartTargets(scenario, state, unit);
  const ids = oublietteTargets(scenario, state, unit);
  for (let n = Math.min(parts.length, ids.length); n > 0; n--) {
    // The largest set of distinct units the parts can be given.
    const pick = largestAssignable(parts, ids, n);
    if (pick) return n;
  }
  return 0;
}

function largestAssignable(
  parts: readonly UnitId[][],
  ids: readonly UnitId[],
  n: number,
): UnitId[] | null {
  const go = (from: number, chosen: UnitId[]): UnitId[] | null => {
    if (chosen.length === n) return oublietteAssignable(parts, chosen) ? chosen : null;
    for (let k = from; k < ids.length; k++) {
      const found = go(k + 1, [...chosen, ids[k]!]);
      if (found) return found;
    }
    return null;
  };
  return go(0, []);
}

/** Bound for the Great Oubliette, used in your own hero phase (in the opponent's it is a reaction). */
export function oublietteOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  if (!usableManifestation(scenario, unit, BOUND_FOR_THE_GREAT_OUBLIETTE_ID)) return [];
  if (!inOwnHeroPhase(state, unit)) return [];
  if (oublietteUsed(unit)) return [];
  const targets = oublietteTargets(scenario, state, unit);
  if (targets.length === 0) return [];
  return [
    {
      t: 'ability',
      abilityId: BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
      name: 'Bound for the Great Oubliette',
      kind: 'activated',
      targets,
      maxTargets: oublietteMax(scenario, state, unit),
      partTargets: oubliettePartTargets(scenario, state, unit),
    },
  ];
}

/**
 * Bound for the Great Oubliette in "any hero phase": offered to the player who is not active, as
 * a reaction after the active player has finished the phase (Core 13.0). Null when it has no
 * target.
 */
export function oublietteReaction(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): { targets: UnitId[]; max: number; parts: UnitId[][] } | null {
  if (!usableManifestation(scenario, unit, BOUND_FOR_THE_GREAT_OUBLIETTE_ID)) return null;
  if (oublietteUsed(unit)) return null;
  const targets = oublietteTargets(scenario, state, unit);
  return targets.length === 0
    ? null
    : {
        targets,
        max: oublietteMax(scenario, state, unit),
        parts: oubliettePartTargets(scenario, state, unit),
      };
}

/** Bound for the Great Oubliette: each target gets a D3; on a 2+ mortal damage and -Move. */
export function useOubliette(ctx: Ctx, unit: UnitState, ids: readonly UnitId[]): void {
  const { s, scenario } = ctx;
  if (!usableManifestation(scenario, unit, BOUND_FOR_THE_GREAT_OUBLIETTE_ID)) {
    illegal('That unit cannot use Bound for the Great Oubliette.');
  }
  if (oublietteUsed(unit)) illegal('Bound for the Great Oubliette is used once per phase.');
  if (ids.length === 0) illegal('Pick at least one enemy unit.');
  if (!oublietteAssignable(oubliettePartTargets(scenario, s, unit), ids)) {
    illegal(
      'Each target must be an enemy unit within 3" of its own part, and a unit can be picked once per turn.',
    );
  }
  unit.oublietteTargets = [...(unit.oublietteTargets ?? []), ...ids];
  unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), BOUND_FOR_THE_GREAT_OUBLIETTE_ID];
  for (const id of ids) {
    const target = s.units[id]!;
    if (target.status !== 'battlefield') continue;
    const roll = rollD3(ctx, unit.owner, 'Bound for the Great Oubliette');
    if (roll < 2) continue;
    addEffect(s, {
      id: BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
      name: `Bound for the Great Oubliette (-${roll}" Move)`,
      sourceUnit: unit.id,
      targetUnit: target.id,
      owner: unit.owner,
      expires: 'turn',
      data: { amount: roll },
    });
    inflictMortalDamage(ctx, target, roll, 'Bound for the Great Oubliette');
  }
}

/**
 * The NPC's Bound for the Great Oubliette targets: units from `ranked` (best first) while each
 * can still be given a part of its own (the player chooses; the NPC picks automatically, I113).
 */
export function npcOubliettePicks(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  ranked: readonly UnitId[],
): UnitId[] {
  const parts = oubliettePartTargets(scenario, state, unit);
  const picks: UnitId[] = [];
  for (const id of ranked) {
    if (oublietteAssignable(parts, [...picks, id])) picks.push(id);
  }
  return picks;
}

/**
 * The NPC's Mechanisms of Time: Increase Time Flow when a friendly unit wholly within 12" has an
 * enemy within 18" to charge, otherwise Decrease Time Flow.
 */
export function npcTimeFlow(scenario: Scenario, state: GameState, cogs: UnitState): TimeFlow {
  const enemies = unitsOf(state, cogs.owner === 0 ? 1 : 0);
  const chargers = unitsOf(state, cogs.owner).filter(
    (u) =>
      !u.isManifestation &&
      unitWhollyWithin(scenario, cogs, u, MECHANISMS_AREA) &&
      enemies.some((e) => unitsWithin(scenario, u, e, 18)),
  );
  return chargers.length > 0 ? 'increase' : 'decrease';
}

// ─── Morbid Detonation ──────────────────────────────────────────────────────────

/**
 * End of any turn: each Malevolent Maelstrom with 6 maelstrom points must detonate: a dice for
 * each other unit within 9", friendly and enemy; on a 2+ that much mortal damage; then it is
 * destroyed.
 */
export function morbidDetonations(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const id of [...s.unitOrder]) {
    const unit = s.units[id]!;
    if (!usableManifestation(scenario, unit, MORBID_DETONATION_ID)) continue;
    if ((unit.maelstrom ?? 0) < MAELSTROM_POINTS_MAX) continue;
    const targets = s.unitOrder
      .map((t) => s.units[t]!)
      .filter(
        (t) =>
          t.id !== unit.id &&
          t.status === 'battlefield' &&
          !profileOf(scenario, t).isFactionTerrain &&
          aliveIndices(t).length > 0 &&
          unitsWithin(scenario, unit, t, DETONATION_RANGE),
      );
    ctx.events.push({ t: 'note', text: `${unit.name} detonates (Morbid Detonation).` });
    for (const target of targets) {
      const roll = d6(ctx);
      ctx.events.push({ t: 'roll', player: unit.owner, label: 'Morbid Detonation', dice: [roll] });
      if (roll >= 2 && target.status === 'battlefield') {
        inflictMortalDamage(ctx, target, roll, 'Morbid Detonation');
      }
    }
    destroyUnit(ctx, unit, 'Morbid Detonation');
  }
}
