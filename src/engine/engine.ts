import './abilities/lores.js';
import { declareAbility } from './abilities/magic.js';
import { illegal, type Ctx } from './ctx.js';
import { attackerOf, isFactionTerrainUnit, profileOf, unitById } from './query.js';
import { RngCursor, rngFromSeed } from './rng.js';
import { deployArmies } from './setup.js';
import {
  buildDeploymentFrames,
  createReserveUnits,
  npcDeployPlacement,
  placeFactionTerrain,
} from './deployment.js';
import { suggestFugitive } from '../rules/core/battleTactics.js';
import { initFury, resolveEruptionOfFury } from '../rules/core/fury.js';
import { resolvePlaceOfPower, type PlaceOfPowerBoon } from './terrain.js';
import { type AlarielleSeason } from '../rules/factions/sylvaneth.js';
import { burgeoningOptions, seasonsAllowed } from '../rules/factions/seasons.js';
import { friendlyWyldwoods } from './overgrowth.js';
import { WYLDWOOD_SETUP_ID } from './wyldwood.js';
import {
  type Action,
  type Engine,
  type GameState,
  type NewGameOptions,
  type PlayerId,
  type Scenario,
  type StepResult,
  type UnitId,
  type UnitState,
} from './types.js';
import { eligibleFighters } from './eligibility.js';
import { cloneState } from './clone.js';
import {
  advancePhase,
  chooseCreepingDread,
  chooseFugitive,
  choosePriority,
  continueRound,
  startRound,
} from './turns.js';
import { checkPlacement, decision, targetOptions, unitOptions } from './decisions.js';
import {
  cancelWyldwood,
  counterCharge,
  coveringFire,
  declareMove,
  forwardToVictory,
  magicalIntervention,
  powerThrough,
  rally,
  redeploy,
  setUpWyldwood,
} from './commands.js';
import { flushMortalDamage } from './combat.js';
import { declareCharge, place, skipPlace } from './placing.js';
import { answerReaction, offerEndOfPhaseReaction } from './reactions.js';
import { declareFight, declareShoot, declareTargets, settle } from './declare.js';

export {
  CP_PER_ROUND,
  MAX_CHARGE_REACH,
  currentFightTier,
  eligibleFighters,
  powerThroughTargets,
} from './eligibility.js';
export { cloneState } from './clone.js';

export function createEngine(scenario: Scenario): Engine {
  /**
   * Every action that names a unit must name a unit that exists and belongs to the player
   * who is deciding (the active player cannot act with enemy units, and vice versa).
   */
  function requireOwnUnit(
    state: GameState,
    unitId: UnitId,
    player: PlayerId,
    allowTerrain = false,
  ): UnitState {
    const unit = state.units[unitId];
    if (!unit) illegal(`There is no unit "${unitId}".`);
    if (unit.owner !== player) illegal(`${unit.name} belongs to the other player.`);
    if (isFactionTerrainUnit(scenario, unit) && !allowTerrain) {
      illegal(`${unit.name} is faction terrain: it cannot move, shoot, charge or fight.`);
    }
    return unit;
  }

  function apply(state: GameState, action: Action): StepResult {
    const d = decision(scenario, state);
    if (!d) illegal('The game has ended.');
    if (
      'unit' in action &&
      typeof action.unit === 'string' &&
      (d.kind === 'main' || d.kind === 'fightPick' || d.kind === 'reaction')
    ) {
      requireOwnUnit(
        state,
        action.unit,
        d.player,
        action.t === 'ability' && action.abilityId === WYLDWOOD_SETUP_ID,
      );
    }
    const s = cloneState(state);
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };

    switch (d.kind) {
      case 'priority':
        if (action.t !== 'choose') illegal('Choose to take the first or second turn.');
        choosePriority(ctx, action.value);
        break;
      case 'fugitive':
        if (action.t !== 'choose') illegal('Pick the enemy Hero to be the fugitive.');
        chooseFugitive(ctx, action.value);
        break;
      case 'main': {
        const top = s.stack[s.stack.length - 1];
        if (top?.t === 'magicalIntervention') {
          if (action.t === 'pass') {
            s.units[top.unit]!.magicalIntervention = false;
            s.stack.pop();
          } else if (action.t === 'ability' && action.unit === top.unit) {
            declareAbility(ctx, action);
          } else {
            illegal('Cast a spell, chant a prayer, or pass.');
          }
          break;
        }
        if (action.t === 'pass') {
          if (!offerEndOfPhaseReaction(ctx)) {
            advancePhase(ctx);
          }
        } else if (action.t === 'move') {
          declareMove(ctx, action.unit, action.kind, action.atTheDouble);
        } else if (action.t === 'ability' && action.abilityId === WYLDWOOD_SETUP_ID) {
          setUpWyldwood(ctx, action.unit);
        } else if (action.t === 'ability' && action.abilityId === 'place-of-power') {
          illegal('A Place of Power can only be activated at the start of a turn.');
        } else if (action.t === 'ability' && d.phase === 'hero') {
          declareAbility(ctx, action);
        } else if (
          action.t === 'ability' &&
          d.phase === 'end' &&
          action.abilityId === 'eruption-of-fury'
        ) {
          const unit = s.units[action.unit]!;
          const option = unitOptions(scenario, state, action.unit).find(
            (o) => o.t === 'ability' && o.abilityId === 'eruption-of-fury',
          );
          if (!option || option.t !== 'ability') {
            illegal(`${unit.name} cannot use Eruption of Fury now.`);
          }
          const targetId = action.target ?? option.targets[0];
          if (!targetId || !option.targets.includes(targetId)) {
            illegal('Eruption of Fury must target an enemy unit in combat with the unit.');
          }
          const profile = profileOf(scenario, unit);
          const meleeWeapons = profile.weapons.filter((w) => w.kind === 'melee');
          const melee =
            action.weaponId === undefined
              ? meleeWeapons[0]
              : meleeWeapons.find((w) => w.id === action.weaponId);
          if (!melee) illegal(`${unit.name} has no such melee weapon for Eruption of Fury.`);
          const max = option.maxRageDice ?? 1;
          const dice = action.rageDice ?? max;
          if (!Number.isInteger(dice) || dice < 1 || dice > max) {
            illegal(`Spend between 1 and ${max} rage dice on Eruption of Fury.`);
          }
          resolveEruptionOfFury(ctx, unit, s.units[targetId]!, melee, dice);
        } else if (action.t === 'command') {
          if (d.phase === 'hero' && action.command === 'rally') {
            rally(ctx, action.unit);
          } else if (d.phase === 'hero' && action.command === 'magicalIntervention') {
            magicalIntervention(ctx, action.unit);
          } else if (d.phase === 'movement' && action.command === 'atTheDouble') {
            declareMove(ctx, action.unit, 'run', true);
          } else if (d.phase === 'movement' && action.command === 'redeploy') {
            redeploy(ctx, action.unit);
          } else if (d.phase === 'shooting' && action.command === 'coveringFire') {
            coveringFire(ctx, action.unit);
          } else if (d.phase === 'charge' && action.command === 'forwardToVictory') {
            forwardToVictory(ctx, action.unit);
          } else if (d.phase === 'charge' && action.command === 'counterCharge') {
            counterCharge(ctx, action.unit);
          } else if (d.phase === 'end' && action.command === 'powerThrough') {
            powerThrough(ctx, action.unit, action.target);
          } else {
            illegal(`Command "${action.command}" is not available in the ${d.phase} phase.`);
          }
        } else if (action.t === 'shoot' && d.phase === 'shooting') {
          declareShoot(ctx, action);
        } else if (action.t === 'charge' && d.phase === 'charge') {
          declareCharge(ctx, action.unit);
        } else {
          illegal(`Action "${action.t}" is not available in the ${d.phase} phase.`);
        }
        break;
      }
      case 'place':
        if (action.t === 'pass') {
          if (d.reason === 'deploy') {
            // Only a unit with no legal place left may be left out (it stays in reserve).
            if (npcDeployPlacement(scenario, s, s.units[d.unit]!)) {
              illegal('Deployment placement is mandatory; pass is not allowed.');
            }
            s.stack.pop();
            ctx.events.push({
              t: 'note',
              text: `${s.units[d.unit]!.name} has no legal place to deploy and stays in reserve.`,
            });
            if (s.stack.length === 0) startRound(ctx);
            break;
          }
          if (d.reason === 'setUp') {
            s.stack.pop();
            cancelWyldwood(ctx, d.unit);
          } else skipPlace(ctx);
        } else if (action.t === 'place') place(ctx, action.placement);
        else if (
          action.t === 'command' &&
          action.command === 'forwardToVictory' &&
          d.reason === 'charge' &&
          action.unit === d.unit
        ) {
          forwardToVictory(ctx, action.unit);
        } else illegal('Place the unit or leave it where it is.');
        break;
      case 'fightPick':
        if (action.t === 'fight') declareFight(ctx, d.player, action.unit);
        else if (action.t === 'pass' && d.canPass) {
          // Declines to attack faction terrain with every optional fighter of this tier.
          for (const u of eligibleFighters(scenario, s, d.player)) {
            s.units[u.id]!.declinedTerrainFight = true;
          }
        } else illegal('Pick a unit to fight.');
        break;
      case 'targets':
        if (action.t !== 'targets') illegal('Choose targets for the weapons.');
        declareTargets(ctx, action);
        break;
      case 'reaction':
        answerReaction(ctx, action);
        break;
      case 'placeOfPower': {
        const frame = s.stack.pop();
        if (frame?.t !== 'placeOfPower') illegal('Not at Place of Power.');
        if (action.t === 'pass') {
          break;
        }
        if (action.t === 'choose') {
          const boon = action.value as PlaceOfPowerBoon;
          if (!['ignite_fury', 'channelled_wrath', 'dizzying_rage'].includes(boon)) {
            illegal('Invalid Place of Power boon.');
          }
          const hero = s.units[frame.hero]!;
          resolvePlaceOfPower(ctx, hero, boon);
          break;
        }
        illegal('Choose a Place of Power boon or pass.');
        break;
      }
      case 'alarielleSeason': {
        const frame = s.stack.pop();
        if (frame?.t !== 'alarielleSeason') illegal('Not choosing Alarielle season.');
        if (action.t !== 'choose') illegal('Choose a season of war.');
        // Unit and feature IDs contain colons, so split at the first one only.
        const colon = action.value.indexOf(':');
        const season = colon < 0 ? action.value : action.value.slice(0, colon);
        const picks = colon < 0 ? undefined : action.value.slice(colon + 1);
        if (!seasonsAllowed(state).includes(season as AlarielleSeason)) {
          illegal('Pick a season of war other than the one picked last battle round.');
        }
        delete s.burgeoningChoices;
        if (picks !== undefined) {
          // `<wyldwood id>=<feature id>`, one per Awakened Wyldwood, joined by commas.
          if (season !== 'burgeoning') illegal('Only The Burgeoning names terrain features.');
          const wyldwoods = friendlyWyldwoods(scenario, state, frame.player).map((w) => w.id);
          const options = burgeoningOptions(scenario, state, frame.player);
          const choices: Record<string, string> = {};
          for (const pick of picks.split(',')) {
            const [wyldwood = '', feature = ''] = pick.split('=');
            if (!wyldwoods.includes(wyldwood))
              illegal('That is not one of your Awakened Wyldwoods.');
            if (!options.some((f) => f.id === feature)) {
              illegal('The Burgeoning cannot name that terrain feature.');
            }
            choices[wyldwood] = feature;
          }
          s.burgeoningChoices = choices;
        }
        s.alarielleSeason = { ...(s.alarielleSeason ?? {}), [s.round]: season };
        s.alarielleSeasonPlayer = frame.player;
        ctx.events.push({
          t: 'note',
          text: `Alarielle proclaims the Season of War: ${season}.`,
        });
        continueRound(ctx);
        break;
      }
      case 'creepingDread':
        if (action.t === 'pass') s.stack.pop();
        else if (action.t === 'choose') chooseCreepingDread(ctx, action.value);
        else illegal('Pick Creeping Dread targets, or pass.');
        break;
    }
    do {
      flushMortalDamage(ctx);
      settle(ctx);
    } while ((s.pendingMortal?.length ?? 0) > 0);
    s.rng = ctx.rng.state;
    return { state: s, events: ctx.events };
  }

  // Set-up uses no dice, so it is computed once per engine and copied for each game.
  let deployed: UnitState[] | null = null;

  /** Quick start: the armies plus both armies' faction terrain, set up legally. */
  function withFactionTerrain(units: UnitState[]): UnitState[] {
    return [...units, ...placeFactionTerrain(scenario, units)].sort(
      (a, b) => a.owner - b.owner || a.armyIndex - b.armyIndex,
    );
  }

  function newGame(seed: number, options?: NewGameOptions): GameState {
    const isDeployMode = Boolean(options?.deploy);
    const unitsList = isDeployMode
      ? createReserveUnits(scenario)
      : (deployed ??= withFactionTerrain(deployArmies(scenario)));
    const units = unitsList.map((u) => ({ ...u, models: u.models.map((m) => ({ ...m })) }));
    const s: GameState = {
      seed,
      rng: rngFromSeed(seed),
      status: 'playing',
      round: 1,
      turnIndex: 0,
      active: 0,
      firstPlayer: 0,
      phase: 'hero',
      players: [
        { cp: 0, vp: 0, vpByRound: [], commandsUsed: [], spellsAttempted: [] },
        { cp: 0, vp: 0, vpByRound: [], commandsUsed: [], spellsAttempted: [] },
      ],
      units: Object.fromEntries(units.map((u) => [u.id, u])),
      unitOrder: units.map((u) => u.id),
      objectives: scenario.battlefield.objectives.map((o) => ({ id: o.id, controller: null })),
      stack: [],
      fightPicker: null,
      fightTier: null,
      winner: null,
      seizedBy: null,
      effects: [],
      banishedThisTurn: [],
      reactionsOffered: [],
    };
    initFury(s, attackerOf(scenario));
    s.active = attackerOf(scenario);
    s.firstPlayer = attackerOf(scenario);
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };
    if (isDeployMode) {
      s.stack = buildDeploymentFrames(scenario, s.units);
    } else {
      startRound(ctx);
      flushMortalDamage(ctx);
    }
    s.rng = ctx.rng.state;
    return s;
  }

  function defaultAction(state: GameState): Action {
    const d = decision(scenario, state);
    if (!d) illegal('The game has ended.');
    switch (d.kind) {
      case 'priority':
        return { t: 'choose', value: 'first' };
      case 'placeOfPower':
        // Optional: the default declines, so engine-driven games keep their dice.
        return { t: 'pass' };
      case 'alarielleSeason':
        return { t: 'choose', value: d.seasons[0]! };
      case 'fugitive':
        return { t: 'choose', value: suggestFugitive(scenario, state, d.player) ?? d.units[0]! };
      case 'creepingDread':
        return { t: 'pass' };
      case 'fightPick':
        if (d.canPass) return { t: 'pass' };
        return { t: 'fight', unit: eligibleFighters(scenario, state, d.player)[0]!.id };
      case 'place':
        if (d.reason === 'deploy') {
          const placement = npcDeployPlacement(scenario, state, unitById(state, d.unit));
          return placement ? { t: 'place', placement } : { t: 'pass' };
        }
        return { t: 'pass' };
      case 'targets':
        return {
          t: 'targets',
          allocations: targetOptions(scenario, state, d.unit, d.mode).map((w) => ({
            weaponId: w.weaponId,
            target: w.targets[0]!.unit,
          })),
        };
      default:
        return { t: 'pass' };
    }
  }

  return {
    scenario,
    newGame,
    decision: (state) => decision(scenario, state),
    unitOptions: (state, unitId) => unitOptions(scenario, state, unitId),
    targetOptions: (state, unitId, mode) => targetOptions(scenario, state, unitId, mode),
    checkPlacement: (state, placement) => checkPlacement(scenario, state, placement),
    apply,
    defaultAction,
  };
}
