/**
 * The NPC and the Sylvaneth set-up and charge abilities (R11, I103.7, I108): Huntmaster's Strike,
 * Rhythm of the Chase, Merciless Ambush, Shadowcreep, Realmroot Guide and Guardian Of The Glades.
 * It uses one only when it serves the plan to win, judged with the same measures as the rest of
 * the baseline (objectives it does not hold, the reach of its charge, expected damage). Every
 * entry point returns at once when the army has no such ability or the use is spent, so turns
 * without an option cost a few lookups. Deterministic; it never rolls dice.
 */
import {
  aliveIndices,
  formPlacement,
  opponent,
  profileOf,
  unitCentre,
  unitDistance,
  unitsOf,
  type Action,
  type Decision,
  type Engine,
  type GameState,
  type Placement,
  type PlayerId,
  type ReactionOption,
  type Scenario,
  type UnitId,
  type UnitState,
} from '../engine/index.js';
import {
  GUARDIAN_OF_THE_GLADES_ID,
  HUNTMASTERS_STRIKE_ID,
  MERCILESS_AMBUSH_ID,
  REALMROOT_GUIDE_ID,
  RHYTHM_OF_THE_CHASE_ID,
  SHADOWCREEP_ID,
} from '../engine/abilities/sylvaneth.js';
import { featureDistance, overgrownTokenIds, terrainFeatures } from '../engine/overgrowth.js';
import {
  canMercilessAmbush,
  canShadowcreep,
  guardianTargets,
  hasSylvanethAbility,
  realmrootCompanions,
  canGuardian,
} from '../engine/relocate.js';
import { inCombat, isFactionTerrainUnit, unitFootprints } from '../engine/query.js';
import { replacementPlacement } from './replacement.js';

/** The pieces of the baseline's own heuristics this module reuses (injected: no import cycle). */
export interface PlanHelpers {
  /** One of the unit's models is on an objective it contests. */
  contesting(unit: UnitState): boolean;
  /** Where the unit's plan takes it this turn, and how far. */
  destination(state: GameState, unit: UnitState): { x: number; y: number; distance: number } | null;
  isRanged(unit: UnitState): boolean;
}

/** CP the NPC keeps in hand before it spends on optional commands (as in `baseline.ts`). */
const SPARE_CP = 2;
/** The NPC charges when the closest enemy is at most this far (as in `baseline.ts`). */
const CHARGE_GAP = 7.5;
/** Merciless Ambush is worth a try only against an enemy this close to a token feature (X averages 7). */
const AMBUSH_REACH = 6;

const ALL_IDS = [
  HUNTMASTERS_STRIKE_ID,
  RHYTHM_OF_THE_CHASE_ID,
  MERCILESS_AMBUSH_ID,
  SHADOWCREEP_ID,
  REALMROOT_GUIDE_ID,
  GUARDIAN_OF_THE_GLADES_ID,
];
const known = new WeakMap<Scenario, Map<UnitId, boolean>>();

/** Whether the unit carries any of the six abilities (fixed for the battle, so cached). */
function hasAny(scenario: Scenario, unit: UnitState): boolean {
  let m = known.get(scenario);
  if (!m) known.set(scenario, (m = new Map()));
  let v = m.get(unit.id);
  if (v === undefined) {
    v = ALL_IDS.some((id) => hasSylvanethAbility(scenario, unit, id));
    m.set(unit.id, v);
  }
  return v;
}

function canUse(scenario: Scenario, unit: UnitState): boolean {
  return unit.status === 'battlefield' && !unit.isManifestation && hasAny(scenario, unit);
}

/** The set-up being decided, if a Sylvaneth ability is placing a unit again. */
function relocation(state: GameState) {
  const top = state.stack[state.stack.length - 1];
  return top?.t === 'place' ? top.relocate : undefined;
}

/**
 * Merciless Ambush: within 1/2" of an enemy unit, the nearest few first, ringed at half-inch
 * steps from the enemy's centre; the first legal spot (the unit is set up facing the enemy).
 */
function ambushPlacement(engine: Engine, state: GameState, unit: UnitState): Placement | null {
  const from = unitCentre(unit);
  const enemies = unitsOf(state, opponent(unit.owner))
    .filter((e) => e.status === 'battlefield' && !isFactionTerrainUnit(engine.scenario, e))
    .sort(
      (a, b) =>
        unitDistance(engine.scenario, unit, a) - unitDistance(engine.scenario, unit, b) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, 3);
  for (const e of enemies) {
    const c = unitCentre(e);
    const toward = Math.atan2(from.y - c.y, from.x - c.x);
    for (let r = 1; r <= 12; r += 0.5) {
      for (let k = 0; k < 8; k++) {
        const a = toward + (k * Math.PI) / 4;
        const centre = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        const facing = ((a + Math.PI) * 180) / Math.PI;
        const p = formPlacement(engine.scenario, unit, centre, facing);
        if (engine.checkPlacement(state, p).length === 0) return p;
      }
    }
  }
  return null;
}

/**
 * The spot for a unit being set up by one of these abilities, or null to leave it (Rhythm of
 * the Chase leaves the unit in the fight it is in; the others go to an objective it wants).
 */
export function relocatePlacement(
  engine: Engine,
  state: GameState,
  unit: UnitState,
): Placement | null {
  const kind = relocation(state)?.kind;
  if (kind === 'ambush') return ambushPlacement(engine, state, unit);
  if (kind === 'rhythm' || !kind) return null;
  return replacementPlacement(engine, state, unit);
}

/**
 * Declares the ability and plays its set-up forward: true if every unit it sets up has a legal
 * spot, so the NPC never declares a use it then has to take back.
 */
function setUpWorks(engine: Engine, state: GameState, action: Action): boolean {
  let s = engine.apply(state, action).state;
  for (let guard = 0; guard < 3; guard++) {
    const d: Decision | null = engine.decision(s);
    if (d?.kind !== 'place' || d.reason !== 'relocate') return guard > 0;
    const p = relocatePlacement(engine, s, s.units[d.unit]!);
    if (!p) return false;
    s = engine.apply(s, { t: 'place', placement: p }).state;
  }
  return true;
}

/** Movement phase: Shadowcreep, then Realmroot Guide, for a unit whose walk cannot reach its goal. */
export function sylvanethMovementAction(
  engine: Engine,
  state: GameState,
  player: PlayerId,
  h: PlanHelpers,
): Action | null {
  const { scenario } = engine;
  for (const unit of unitsOf(state, player)) {
    if (!canUse(scenario, unit)) continue;
    const bear = canShadowcreep(scenario, state, unit);
    const companions = realmrootCompanions(scenario, state, unit);
    if (!bear && !companions) continue;
    if (inCombat(scenario, state, unit) || h.contesting(unit)) continue;
    const goal = h.destination(state, unit);
    // Walking gets it there this turn: no need.
    if (!goal || goal.distance <= profileOf(scenario, unit).move) continue;
    if (bear) {
      const a: Action = { t: 'ability', unit: unit.id, abilityId: SHADOWCREEP_ID };
      if (setUpWorks(engine, state, a)) return a;
    }
    if (companions) {
      // Alone, or with the friend worth the most points that also has a spot.
      const withOthers = [...companions]
        .sort(
          (a, b) =>
            profileOf(scenario, state.units[b]!).points -
              profileOf(scenario, state.units[a]!).points || (a < b ? -1 : 1),
        )
        .slice(0, 3)
        .map((c): Action => ({
          t: 'ability',
          unit: unit.id,
          abilityId: REALMROOT_GUIDE_ID,
          target: c,
        }));
      for (const a of [
        ...withOthers,
        { t: 'ability', unit: unit.id, abilityId: REALMROOT_GUIDE_ID } as Action,
      ]) {
        if (setUpWorks(engine, state, a)) return a;
      }
    }
  }
  return null;
}

/**
 * Charge phase, `guardian` stage (before the normal charges): Guardian Of The Glades in place
 * of the Charge button when an enemy in combat with
 * a friendly Sylvaneth Hero is within reach of a charge rolled with +2. `ambush` stage (after them): Merciless
 * Ambush for a melee unit that cannot charge normally, against an enemy near a feature that has
 * its overgrown token. Returns the declaring action, or null.
 */
export function sylvanethChargeAction(
  engine: Engine,
  state: GameState,
  player: PlayerId,
  h: PlanHelpers,
  stage: 'guardian' | 'ambush',
): Action | null {
  const { scenario } = engine;
  const cp = state.players[player].cp;
  for (const unit of unitsOf(state, player)) {
    if (!canUse(scenario, unit) || h.isRanged(unit)) continue;
    if (stage === 'guardian') {
      if (!canGuardian(scenario, state, unit)) continue;
      const near = guardianTargets(scenario, state, unit).reduce(
        (gap, id) => Math.min(gap, unitDistance(scenario, unit, state.units[id]!)),
        Infinity,
      );
      if (near <= CHARGE_GAP + 2) {
        return { t: 'ability', unit: unit.id, abilityId: GUARDIAN_OF_THE_GLADES_ID };
      }
      continue;
    }
    if (cp < SPARE_CP || !canMercilessAmbush(scenario, state, unit)) continue;
    // Only when a normal charge is out of reach, and an enemy is near enough to be reached.
    const foes = unitsOf(state, opponent(player)).filter(
      (e) => e.status === 'battlefield' && !isFactionTerrainUnit(scenario, e),
    );
    if (foes.some((e) => unitDistance(scenario, unit, e) <= CHARGE_GAP)) continue;
    const tokens = overgrownTokenIds(scenario, state, player);
    const reachable = terrainFeatures(scenario, state).some(
      (f) =>
        tokens.includes(f.id) &&
        foes.some((e) => featureDistance(scenario, f, unitFootprints(scenario, e)) <= AMBUSH_REACH),
    );
    if (!reachable) continue;
    return { t: 'command', command: 'mercilessAmbush', unit: unit.id };
  }
  return null;
}

/** Reactions: Huntmaster's Strike, Rhythm of the Chase and the Merciless Ambush confirmation. */
export function sylvanethReaction(
  engine: Engine,
  state: GameState,
  options: readonly ReactionOption[],
  h: PlanHelpers,
): Action | null {
  const { scenario } = engine;
  for (const o of options) {
    if (o.ability === 'mercilessAmbush') {
      // The NPC only declares it when it wants it: confirm.
      return { t: 'ability', unit: o.unit, abilityId: MERCILESS_AMBUSH_ID };
    }
    const unit = state.units[o.unit];
    if (!unit || !canUse(scenario, unit)) continue;
    if (o.ability === 'rhythmOfTheChase' && o.targets && o.targets.length > 0) {
      // Free damage: at the enemy it is likeliest to finish (fewest wounds left), then by points.
      const left = (id: UnitId): number => {
        const t = state.units[id]!;
        return profileOf(scenario, t).health * aliveIndices(t).length - t.damage;
      };
      const target = [...o.targets].sort(
        (a, b) =>
          left(a) - left(b) ||
          profileOf(scenario, state.units[b]!).points -
            profileOf(scenario, state.units[a]!).points ||
          (a < b ? -1 : 1),
      )[0]!;
      return { t: 'ability', unit: o.unit, abilityId: RHYTHM_OF_THE_CHASE_ID, target };
    }
    if (o.ability === 'huntmastersStrike') {
      // Worth it to take an objective it does not hold, from outside combat and off any objective.
      if (inCombat(scenario, state, unit) || h.contesting(unit)) continue;
      const a: Action = { t: 'ability', unit: o.unit, abilityId: HUNTMASTERS_STRIKE_ID };
      if (setUpWorks(engine, state, a)) return a;
    }
  }
  return null;
}
