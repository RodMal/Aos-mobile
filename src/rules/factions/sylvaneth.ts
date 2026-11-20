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
 *    - Budding Forest: carries its owner's overgrown token.
 *    - Ever Growing: at the start of each battle round, the closest terrain feature without a
 *      friendly token gains one unless the opponent controls it.
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
import { illegal, type Ctx } from '../../engine/ctx.js';
import { abilitiesOf, hasEffectiveKeyword } from '../../engine/abilities/effects.js';
import { ASPECT_OF_HEARTWOOD_ID } from '../../engine/abilities/sylvaneth.js';
import { battleKey, usedThisBattle } from '../../engine/relocate.js';
import { returnPosition } from '../../engine/damage.js';
import {
  closestFeatureWithoutToken,
  creepingOvergrowthRange,
  featureController,
  giveOvergrownToken,
  hasOvergrownToken,
  inCreepingOvergrowth,
  isAwakenedWyldwood,
  terrainFeatures,
} from '../../engine/overgrowth.js';
import {
  opponent,
  profileOf,
  unitFootprints,
  unitWhollyWithin,
  unitsOf,
} from '../../engine/query.js';
import type {
  EndGrowthFrame,
  GameState,
  GrowthMode,
  PlayerId,
  Scenario,
  UnitState,
} from '../../engine/types.js';

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

/** The creeping overgrowth lives in `engine/overgrowth.ts`; re-exported for the rules. */
export { creepingOvergrowthRange };

/** True when `unit` is within (or wholly within) `player`'s creeping overgrowth. */
export function isWithinCreepingOvergrowth(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  player: PlayerId,
  whollyWithin = false,
): boolean {
  return inCreepingOvergrowth(scenario, state, unit, player, whollyWithin);
}

/**
 * Ever Growing (Awakened Wyldwood, 8c86-1655-c6c7-be0b; Once Per Battle Round, Start of
 * Battle Round): "Pick the closest terrain feature to this terrain feature that does not have
 * a friendly overgrown token to be the target. If the target is not controlled by your
 * opponent, give that target a friendly overgrown token."
 *
 * Used by every Awakened Wyldwood on the battlefield, in unit order, for its owner. There is
 * no range limit. `pick` (The Burgeoning) may name any terrain feature the opponent does not
 * control instead of the closest; it returns undefined to keep the closest.
 */
export function applyEverGrowing(
  scenario: Scenario,
  state: GameState,
  pick?: (wyldwood: UnitState) => string | undefined,
): string[] {
  const notes: string[] = [];
  for (const id of state.unitOrder) {
    const w = state.units[id]!;
    if (w.status !== 'battlefield' || !isAwakenedWyldwood(scenario, w)) continue;
    const player = w.owner;
    const enemy = opponent(player);
    const features = terrainFeatures(scenario, state);
    const chosenId = pick?.(w);
    const chosen = chosenId ? features.find((f) => f.id === chosenId) : undefined;
    const target =
      chosen && !hasOvergrownToken(scenario, state, player, chosen.id)
        ? chosen
        : closestFeatureWithoutToken(scenario, state, player, unitFootprints(scenario, w), w.id);
    if (!target) continue;
    if (featureController(scenario, state, target) === enemy) {
      notes.push(`Ever Growing: ${target.name} is controlled by the opponent; no token.`);
      continue;
    }
    giveOvergrownToken(state, player, target.id);
    notes.push(`Ever Growing: ${target.name} gains an overgrown token.`);
  }
  return notes;
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
 * Runs at the end of every turn for each army that has the trait, from an `endGrowth` frame that
 * `advanceEndlessGrowth` works through target by target. The player chooses (Core 28.0, "can";
 * I112) the effect for each target once the D3 is rolled, and whether Aspect of Heartwood applies
 * to a target in its reach; a question is asked only where there is a real choice. The NPC and
 * engine-driven games take the automatic answer (`autoGrowthAnswer`): Aspect of Heartwood when it
 * helps, and returning models when at least one slain model fits in the roll (a returned model is
 * always worth more than the damage on one model), otherwise healing. Faction terrain is a
 * terrain feature, not a unit to heal, so it is not a target. Units with nothing to restore are
 * skipped without rolling. `resolveEndlessGrowth` runs the whole thing with the automatic answers.
 */
export function resolveEndlessGrowth(ctx: Ctx, player: PlayerId): void {
  const frame: EndGrowthFrame = { t: 'endGrowth', player };
  while (advanceEndlessGrowth(ctx, frame)) {
    const ask = frame.ask!;
    answerEndlessGrowth(
      ctx,
      autoGrowthAnswer(ask.stage, ask.stage === 'aspect' ? ask.options : ['heal', 'return']),
      frame,
    );
  }
}

/** The automatic answer to an Endless Growth question (the NPC's, and the engine default). */
export function autoGrowthAnswer(stage: 'aspect' | 'effect', options: string[]): string {
  if (stage === 'effect') return 'return';
  return options.includes('kurnothi') ? 'kurnothi' : 'd6';
}

/** Slain model indices of `u` that may come back. */
function slainOf(u: UnitState): number[] {
  return u.models.flatMap((m, i) => (m.alive ? [] : [i]));
}

/** Answers the question waiting on the `endGrowth` frame (the top of the stack by default). */
export function answerEndlessGrowth(
  ctx: Ctx,
  value: string,
  frame: EndGrowthFrame | undefined = ctx.s.stack[ctx.s.stack.length - 1] as EndGrowthFrame,
): void {
  const ask = frame?.t === 'endGrowth' ? frame.ask : undefined;
  if (!frame || !ask) illegal('There is no Endless Growth choice to answer.');
  if (ask.stage === 'aspect') {
    if (!(ask.options as string[]).includes(value)) {
      illegal(`Choose one of: ${ask.options.join(', ')}.`);
    }
    frame.mode = value as GrowthMode;
  } else {
    if (value !== 'heal' && value !== 'return') illegal('Choose heal or return.');
    frame.effect = value;
  }
  delete frame.ask;
}

/**
 * Works through the targets of `frame` until a choice is due (`frame.ask` is set and true is
 * returned) or all are done (false). Called again after each answer.
 */
export function advanceEndlessGrowth(ctx: Ctx, frame: EndGrowthFrame): boolean {
  const { scenario, s } = ctx;
  const player = frame.player;
  if (frame.queue === undefined) {
    if (!armyHasBattleTrait(scenario, player, ENDLESS_GROWTH_ID)) {
      frame.queue = [];
      return false;
    }
    const targets = unitsOf(s, player).filter((u) => {
      const p = profileOf(scenario, u);
      if (p.isFactionTerrain) return false;
      if (!hasEffectiveKeyword(scenario, s, u, 'SYLVANETH')) return false;
      return isWithinCreepingOvergrowth(scenario, s, u, player, true);
    });
    // Aspect of Heartwood: a bearer wholly within the creeping overgrowth that has not used it.
    const bearer = targets.find(
      (u) =>
        abilitiesOf(scenario, u).some((a) => a.id === ASPECT_OF_HEARTWOOD_ID) &&
        !usedThisBattle(s, u, ASPECT_OF_HEARTWOOD_ID),
    );
    frame.queue = targets.map((u) => u.id);
    if (bearer) frame.bearer = bearer.id;
  }
  const titans = armyHasFormationAbility(scenario, player, NATURES_TITANS_ID);
  const next = () => {
    frame.queue = frame.queue!.slice(1);
    delete frame.mode;
    delete frame.roll;
    delete frame.effect;
    delete frame.ask;
  };
  while (frame.queue.length > 0) {
    const u = s.units[frame.queue[0]!]!;
    const slain = slainOf(u);
    if (u.damage === 0 && slain.length === 0) {
      next();
      continue;
    }
    const health = profileOf(scenario, u).health;
    const monster = titans && hasEffectiveKeyword(scenario, s, u, 'MONSTER');
    const kurnothi =
      slain.length > 0 &&
      hasEffectiveKeyword(scenario, s, u, 'KURNOTHI') &&
      returnPosition(scenario, s, u, slain[0]!) !== null;
    // For each target wholly within 12" of the bearer, once per battle (I106): the player picks.
    if (frame.mode === undefined) {
      const bearer = frame.bearer === undefined ? undefined : s.units[frame.bearer];
      if (bearer && (u.id === bearer.id || unitWhollyWithin(scenario, bearer, u, 12))) {
        const options: GrowthMode[] =
          kurnothi && !monster ? ['d6', 'kurnothi', 'normal'] : ['d6', 'normal'];
        frame.ask = { stage: 'aspect', unit: u.id, options };
        return true;
      }
      frame.mode = 'normal';
    }
    const aspect = frame.mode !== 'normal';
    if (aspect && frame.bearer !== undefined) {
      // The reaction is spent once, at the first target it is used on.
      const bearer = s.units[frame.bearer]!;
      const key = battleKey(bearer, ASPECT_OF_HEARTWOOD_ID);
      const p = s.players[player];
      if (!(p.usedOncePerBattle ?? []).includes(key)) {
        p.usedOncePerBattle = [...(p.usedOncePerBattle ?? []), key];
        ctx.events.push({ t: 'note', text: `${bearer.name}: Aspect of Heartwood.` });
      }
    }
    if (monster) {
      const healed = Math.min(u.damage, aspect ? 6 : 3);
      u.damage -= healed;
      ctx.events.push({
        t: 'note',
        text: `Endless Growth (Nature's Titans): ${u.name} heals ${healed}.`,
      });
      next();
      continue;
    }
    if (frame.mode === 'kurnothi' && kurnothi) {
      // "Instead of rolling a D3 ... return 1 slain model to the target unit."
      const at = returnPosition(scenario, s, u, slain[0]!)!;
      Object.assign(u.models[slain[0]!]!, at, { alive: true });
      ctx.events.push({
        t: 'note',
        text: `Endless Growth (Aspect of Heartwood): 1 slain model returns to ${u.name}.`,
      });
      next();
      continue;
    }
    if (frame.roll === undefined) {
      frame.roll = ctx.rng.int(1, aspect ? 6 : 3);
      ctx.events.push({
        t: 'roll',
        player,
        label: `Endless Growth (${u.name})`,
        dice: [frame.roll],
      });
    }
    const roll = frame.roll;
    const fit = Math.min(slain.length, Math.floor(roll / health));
    const heal = Math.min(u.damage, roll);
    // A real choice only when both effects do something.
    if (frame.effect === undefined && fit > 0 && heal > 0) {
      frame.ask = { stage: 'effect', unit: u.id, roll, heal, models: fit };
      return true;
    }
    if ((frame.effect ?? (fit > 0 ? 'return' : 'heal')) === 'return') {
      let returned = 0;
      for (const i of slain.slice(0, fit)) {
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
        next();
        continue;
      }
    }
    u.damage -= heal;
    ctx.events.push({ t: 'note', text: `Endless Growth: ${u.name} heals ${heal}.` });
    next();
  }
  return false;
}
