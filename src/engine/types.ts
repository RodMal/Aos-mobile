/**
 * The engine contract. The UI, the NPC and the tests all talk to the engine through these
 * types only.
 *
 * Design rules:
 * - `GameState` is plain JSON-serialisable data. Static data (profiles, battlefield, army
 *   lists) lives in the `Scenario`, never in the state.
 * - All randomness comes from `GameState.rng`, so a game is fully described by its scenario,
 *   its seed and its list of actions (save, resume, replay, bug reports).
 * - The engine is decision-driven. `decision(state)` says which player must choose what next;
 *   that player answers with an `Action`. This holds during the opponent's turn too (fight
 *   picks, reactions), which is how the human gets prompted while the NPC is playing.
 * - Dice and placement are separate steps: a charge is declared and rolled, then placed.
 * - `apply` never mutates its input and throws `IllegalActionError` for illegal actions.
 */
import type { Battlefield } from '../data/battlefield.js';
import type { Army } from '../data/lists.js';
import type { Side } from '../data/map-schema.js';
import type { UnitProfile } from '../data/profile.js';

export type PlayerId = 0 | 1;
export type UnitId = string;

export const PHASES = ['hero', 'movement', 'shooting', 'charge', 'combat', 'end'] as const;
export type Phase = (typeof PHASES)[number];

export type MoveKind = 'normal' | 'run' | 'retreat';

// ─── Static data ────────────────────────────────────────────────────────────────

/** Everything about a game that never changes while it is played. */
export interface Scenario {
  battlefield: Battlefield;
  armies: [Army, Army];
  /** The map side (territory) each player holds. */
  sides: [Side, Side];
  /** Unit profiles by `UnitProfile.id`. */
  profiles: Record<string, UnitProfile>;
  rounds: number;
}

// ─── State ──────────────────────────────────────────────────────────────────────

/** One model. Its index in `UnitState.models` is its index in `UnitProfile.models`. */
export interface ModelState {
  /** Base centre in inches (origin top-left, x right, y down). */
  x: number;
  y: number;
  /** Degrees, clockwise on screen. Only matters for oval and rectangular bases. */
  rot: number;
  alive: boolean;
}

export interface UnitState {
  id: UnitId;
  owner: PlayerId;
  profileId: string;
  name: string;
  /** Index of this unit in its army list. */
  armyIndex: number;
  models: ModelState[];
  /** Damage points allocated to the unit and not yet enough to slay a model. */
  damage: number;
  status: 'battlefield' | 'reserve' | 'destroyed';
  // Per-turn flags, cleared at the start of each turn.
  /** The move this unit made in the movement phase this turn. */
  moved: MoveKind | null;
  charged: boolean;
  shot: boolean;
  fought: boolean;
  /** Set once the unit has declared a charge this turn, whether or not the charge succeeded. */
  chargeDeclared?: boolean;
  /** The command this unit has used in the current phase (a unit may use one per phase). */
  commandUsed?: CommandId | null;
  /**
   * The unit used All-out Attack this turn: -1 to its save rolls until the end of the turn.
   * The +1 to hit applies only to the attacks it was used for (the `resolve` frame's flag).
   */
  allOutAttack?: boolean;
  /** Spell, prayer, unbind and banish abilities used by this unit in the current phase. */
  castsUsed?: number;
  /** Ritual points accumulated by a Priest across turns until a prayer is answered. */
  ritualPoints?: number;
  /** Ability IDs used by this unit in the current turn (Rule of One per unit). */
  abilitiesUsed?: string[];
  /** Set when a unit/manifestation was set up on the battlefield this turn (bars movement-phase moves). */
  setUpThisTurn?: boolean;
  /** True for summoned manifestation units. */
  isManifestation?: boolean;
  /** Set while the unit is casting/chanting via Magical Intervention (-1 to the roll). */
  magicalIntervention?: boolean;
}

export type TacticTier = 'affray' | 'strike' | 'domination' | 'completed';

export interface PlayerState {
  cp: number;
  vp: number;
  /** Victory points scored in each battle round so far (index 0 is round 1). */
  vpByRound: number[];
  /** Commands this army has used in the current phase (each command once per army per phase). */
  commandsUsed?: CommandId[];
  /** Non-UNLIMITED spell and prayer ability IDs attempted by this army in the current turn. */
  spellsAttempted?: string[];
  /** GHB 2026-27 Scourge of Aqshy Fury level (0..7; attacker starts at 1, defender at 2). */
  furyLevel?: number;
  /** GHB 2026-27 Fury season Rage dice pool for this player. */
  rageDice?: number;
  /** Fury season abilities used by this player in the current turn. */
  furyUsedThisTurn?: string[];
  /** Current step ('affray' -> 'strike' -> 'domination' -> 'completed') for each Battle Tactic card ID. */
  tacticProgress?: Record<string, TacticTier>;
  /** Enemy Hero chosen as the fugitive for Burning for Vengeance. */
  fugitiveUnit?: UnitId | null;
  /** Terrain feature ID chosen as the enemy hideout for Blazing Onslaught. */
  hideoutTerrain?: string | null;
}

export interface ObjectiveState {
  id: string;
  controller: PlayerId | null;
}

export type EffectExpiry = 'attack' | 'phase' | 'turn' | 'startOfNextTurn' | 'battle';

/** A timed buff or debuff in play, stored as plain JSON data. */
export interface ActiveEffect {
  /** BSData ability id or CommandId that created this effect. */
  id: string;
  name: string;
  sourceUnit: UnitId;
  targetUnit: UnitId;
  owner: PlayerId;
  expires: EffectExpiry;
  data?: Record<string, number | string | boolean>;
}

/**
 * A step in progress that needs a further answer. The top frame decides the next decision;
 * with an empty stack the decision is the current phase's main decision.
 */
export type Frame =
  | { t: 'priority'; winner: PlayerId; rolls: [number, number] }
  | {
      t: 'place';
      unit: UnitId;
      reason: PlaceReason;
      /** Maximum distance in inches any model may move (or summon range from caster). */
      allowance: number;
      /** Dice behind the allowance (run: 1 die, charge: 2 dice). */
      dice: number[];
      /** For `reason: 'summon'`: the caster the manifestation must be wholly within `allowance` of. */
      caster?: UnitId;
      /** For `reason: 'summon'`: minimum edge-to-edge distance from enemy units. */
      minEnemyGap?: number;
    }
  | { t: 'targets'; unit: UnitId; mode: AttackMode }
  | { t: 'reaction'; player: PlayerId; options: ReactionOption[]; trigger: string }
  /**
   * Attacks declared and waiting to be rolled, kept under a `reaction` frame while the
   * defender decides on All-out Defence. Never the top frame when a decision is asked for.
   */
  | {
      t: 'resolve';
      unit: UnitId;
      mode: AttackMode;
      allocations: Allocation[];
      allOutAttack: boolean;
      /** Target units that use All-out Defence against these attacks. */
      defended: UnitId[];
      /** Set when the attack is made via Covering Fire (-1 to hit). */
      coveringFire?: boolean;
    }
  /**
   * A spell that met its casting value and is waiting under an Unbind `reaction` frame.
   */
  | {
      t: 'spell';
      unit: UnitId;
      abilityId: string;
      target?: UnitId;
      roll: number;
    }
  /**
   * A Wizard or Priest using Magical Intervention in the enemy hero phase to cast or chant once.
   */
  | {
      t: 'magicalIntervention';
      unit: UnitId;
    }
  /**
   * Marker pushed under an end-of-phase reaction so the phase advances once the reaction finishes.
   */
  | {
      t: 'endPhase';
    }
  /**
   * Start of turn: an eligible Hero within 3" of an unused Place of Power chooses a boon or passes.
   */
  | {
      t: 'placeOfPower';
      player: PlayerId;
      hero: UnitId;
      terrain: string;
    }
  /**
   * Start of battle round: Alarielle chooses a season of war for the round.
   */
  | {
      t: 'alarielleSeason';
      player: PlayerId;
      unit: UnitId;
    };

export type PlaceReason = MoveKind | 'charge' | 'pileIn' | 'summon' | 'powerThrough' | 'deploy';
export type AttackMode = 'shoot' | 'fight';
export type FightTier = 'strikeFirst' | 'normal' | 'strikeLast';

export interface GameState {
  /** The seed the game started from; `rng` is the current generator state. */
  seed: number;
  rng: number;
  status: 'playing' | 'ended';
  /** Battle round, starting at 1. */
  round: number;
  /** 0 during the first turn of the round, 1 during the second. */
  turnIndex: 0 | 1;
  /** The player whose turn it is. */
  active: PlayerId;
  /** The player who takes (or took) the first turn of this round. */
  firstPlayer: PlayerId;
  phase: Phase;
  players: [PlayerState, PlayerState];
  units: Record<UnitId, UnitState>;
  /** Unit ids in a stable display order. */
  unitOrder: UnitId[];
  objectives: ObjectiveState[];
  stack: Frame[];
  /** Units that have fought in the current combat phase are flagged on the unit; this holds
   * the player whose pick is next, or null outside the combat phase. */
  fightPicker: PlayerId | null;
  /** Combat strike-order tier of the last pick in the current combat phase. */
  fightTier?: FightTier | null;
  winner: PlayerId | 'draw' | null;
  /**
   * The player who last seized the initiative. Their opponent counts as the underdog until
   * that opponent seizes in turn. Absent or null when nobody has.
   */
  seizedBy?: PlayerId | null;
  /** The player who seized the initiative in the current round (bars scoring Battle Tactics on their first turn). */
  seizedThisRound?: PlayerId | null;
  /** Timed effects currently in play. */
  effects?: ActiveEffect[];
  /** Warscroll IDs of manifestations removed/destroyed in the current turn. */
  banishedThisTurn?: string[];
  /** Reaction triggers already offered in the current phase. */
  reactionsOffered?: string[];
  /** @deprecated Superseded by `overgrown`; no longer read or written. */
  overgrownTerrain?: string[];
  /**
   * Terrain feature IDs (battlefield terrain or faction terrain unit IDs) with a friendly
   * Sylvaneth overgrown token, per player. Awakened Wyldwoods carry their owner's token
   * implicitly and are not listed.
   */
  overgrown?: [string[], string[]];
  /** Terrain feature IDs whose Place of Power ability has been used in the current turn. */
  usedPlacesOfPower?: string[];
  /** Objective controllers recorded at the start of the current turn (for Battle Tactics). */
  turnStartObjectives?: Record<string, PlayerId | null>;
  /** Unit IDs that were in combat at the start of the current turn (for Daring Rescue). */
  turnStartInCombat?: UnitId[];
  /** Enemy Unit IDs destroyed this turn by a combat attack from a unit that charged this turn. */
  destroyedByChargeCombat?: UnitId[];
  /** Units destroyed during the current turn (for Battle Tactics). */
  unitsDestroyedThisTurn?: { id: UnitId; owner: PlayerId; isHero: boolean }[];
  /** Phases in which each unit had at least 1 damage point allocated to it this turn. */
  damagedInPhases?: Record<UnitId, Phase[]>;
  /** Alarielle's season of war chosen for each battle round: round -> season. */
  alarielleSeason?: Record<number, string>;
}

// ─── Decisions ──────────────────────────────────────────────────────────────────

/** What the engine is waiting for. `player` is who must answer. */
export type Decision =
  /** The priority roll winner chooses to take the first or second turn. */
  | { kind: 'priority'; player: PlayerId; rolls: [number, number] }
  /** Pick a unit and an action for the current phase, or `pass` to end the phase. */
  | { kind: 'main'; player: PlayerId; phase: Phase }
  /** Position a unit's models. `pass` (when `canPass`) leaves the unit where it is. */
  | {
      kind: 'place';
      player: PlayerId;
      unit: UnitId;
      reason: PlaceReason;
      allowance: number;
      dice: number[];
      canPass: boolean;
    }
  /** Pick the next unit to fight. `pass` is only legal when `canPass`. */
  | { kind: 'fightPick'; player: PlayerId; canPass: boolean }
  /** Assign this unit's weapons to targets, then the attacks are rolled. */
  | { kind: 'targets'; player: PlayerId; unit: UnitId; mode: AttackMode }
  /** Optionally use a reaction (a command or ability) before play continues. */
  | { kind: 'reaction'; player: PlayerId; options: ReactionOption[]; trigger: string }
  /** Choose a Place of Power boon at start of turn, or pass. */
  | {
      kind: 'placeOfPower';
      player: PlayerId;
      hero: UnitId;
      terrain: string;
      boons: ('ignite_fury' | 'channelled_wrath' | 'dizzying_rage')[];
    }
  /** Alarielle's player picks a season of war for the battle round. */
  | {
      kind: 'alarielleSeason';
      player: PlayerId;
      unit: UnitId;
      seasons: ('burgeoning' | 'reaping' | 'dwindling' | 'everdusk')[];
    };

export type DecisionKind = Decision['kind'];

export type CommandId =
  | 'rally'
  | 'atTheDouble'
  | 'allOutAttack'
  | 'allOutDefence'
  | 'forwardToVictory'
  | 'redeploy'
  | 'counterCharge'
  | 'coveringFire'
  | 'magicalIntervention'
  | 'powerThrough';

export interface ReactionOption {
  command?: CommandId;
  ability?: 'unbind';
  unit: UnitId;
  cost: number;
}

// ─── Actions ────────────────────────────────────────────────────────────────────

/** Where every living model of a unit ends up. */
export interface Placement {
  unit: UnitId;
  /** One entry per living model; `i` is the model index. */
  models: { i: number; x: number; y: number; rot: number }[];
}

export interface Allocation {
  weaponId: string;
  target: UnitId;
}

export type Action =
  /** End the phase, decline a reaction, skip a pile-in, or leave a unit in place. */
  | { t: 'pass' }
  /** Answer a choice: priority takes 'first' or 'second'. */
  | { t: 'choose'; value: string }
  /** Declare a move. Run rolls a D6 and retreat rolls its damage; then a `place` follows. */
  | {
      t: 'move';
      unit: UnitId;
      kind: MoveKind;
      /** With `kind: 'run'`: spend 1 CP on At the Double, so the run roll counts as 6. */
      atTheDouble?: boolean;
    }
  /** Answer a `place` decision. */
  | { t: 'place'; placement: Placement }
  /** Shoot: each ranged weapon at one target. Set `allOutAttack` to spend the command. */
  | { t: 'shoot'; unit: UnitId; allocations: Allocation[]; allOutAttack?: boolean }
  /** Declare a charge: rolls 2D6, then a `place` decision follows if it can succeed. */
  | { t: 'charge'; unit: UnitId }
  /** Pick this unit to fight: a pile-in `place` follows, then a `targets` decision. */
  | { t: 'fight'; unit: UnitId }
  /** Answer a `targets` decision. */
  | { t: 'targets'; allocations: Allocation[]; allOutAttack?: boolean }
  /**
   * Use a command: Rally, At the Double, All-out Defence, Forward to Victory, Redeploy,
   * Counter-charge, Covering Fire, Magical Intervention, or Power Through.
   */
  | { t: 'command'; command: CommandId; unit: UnitId; target?: UnitId }
  /**
   * Use a spell, prayer, summon, banish, unbind or activated ability.
   */
  | {
      t: 'ability';
      unit: UnitId;
      abilityId: string;
      target?: UnitId;
      secondTarget?: UnitId;
      choice?: string;
    };

export type AbilityOptionKind = 'spell' | 'prayer' | 'summon' | 'banish' | 'activated';

/** What a unit may do under the current `main` or `fightPick` decision. */
export type UnitOption =
  | {
      t: 'move';
      kind: MoveKind;
      /** Inches the unit may move, before any dice (run adds a D6). */
      allowance: number;
    }
  | { t: 'shoot' }
  | { t: 'charge' }
  | { t: 'fight' }
  | { t: 'command'; command: CommandId; cost: number; targets?: UnitId[] }
  | {
      t: 'ability';
      abilityId: string;
      name: string;
      kind: AbilityOptionKind;
      targetValue?: number;
      targets: UnitId[];
    };

/** The legal targets of one weapon, for a `shoot` action or a `targets` decision. */
export interface WeaponTargets {
  weaponId: string;
  weaponName: string;
  targets: {
    unit: UnitId;
    /** How many of the attacking unit's models can attack this target with the weapon. */
    modelsInRange: number;
    /** Expected damage after saves and wards, for display and the NPC. */
    expectedDamage: number;
  }[];
}

/** Why a placement is not allowed. `models` lists the offending model indices, if any. */
export interface Violation {
  code:
    | 'WRONG_MODELS'
    | 'OFF_BOARD'
    | 'TOO_FAR'
    | 'OVERLAP'
    | 'COHERENCY'
    | 'ENEMY_COMBAT_RANGE'
    | 'STILL_IN_COMBAT'
    | 'NOT_IN_CHARGE_RANGE'
    | 'PILE_IN_FURTHER'
    | 'BLOCKED'
    | 'OUTSIDE_TERRITORY'
    | 'TOO_CLOSE_TO_ENEMY_TERRITORY';
  message: string;
  models?: number[];
}

// ─── Events ─────────────────────────────────────────────────────────────────────

/** What happened when an action was applied, for the log and for animation. */
export type GameEvent =
  | { t: 'roundStart'; round: number }
  | { t: 'priority'; rolls: [number, number]; winner: PlayerId }
  | { t: 'turnStart'; player: PlayerId; round: number }
  | { t: 'phaseStart'; phase: Phase; player: PlayerId }
  | { t: 'commandPoints'; player: PlayerId; cp: number }
  | { t: 'moved'; unit: UnitId; kind: PlaceReason; dice: number[]; distance: number }
  | { t: 'chargeRoll'; unit: UnitId; dice: [number, number]; success: boolean }
  | {
      t: 'attacks';
      attacker: UnitId;
      target: UnitId;
      weapon: string;
      mode: AttackMode;
      attacks: number;
      hits: number;
      crits: number;
      wounds: number;
      /** Wounds that got past the save. */
      unsaved: number;
      mortal: number;
      /** Damage points after wards. */
      damage: number;
      warded: number;
      dice: { hit: number[]; wound: number[]; save: number[]; ward: number[] };
    }
  | { t: 'damage'; unit: UnitId; amount: number; slain: number; destroyed: boolean; source: string }
  | { t: 'command'; player: PlayerId; command: CommandId; unit: UnitId }
  | {
      t: 'cast';
      unit: UnitId;
      ability: string;
      dice: [number, number];
      total: number;
      targetValue: number;
      success: boolean;
      miscast: boolean;
    }
  | {
      t: 'unbind';
      unit: UnitId;
      caster: UnitId;
      ability: string;
      dice: [number, number];
      total: number;
      castTotal: number;
      unbound: boolean;
    }
  | {
      t: 'chant';
      unit: UnitId;
      ability: string;
      die: number;
      total: number;
      targetValue: number;
      answered: boolean;
      ritualPoints: number;
    }
  | {
      t: 'banish';
      unit: UnitId;
      target: UnitId;
      dice: [number, number];
      total: number;
      targetValue: number;
      banished: boolean;
    }
  | { t: 'roll'; player: PlayerId; label: string; dice: number[] }
  | { t: 'objective'; objective: string; controller: PlayerId | null }
  | { t: 'score'; player: PlayerId; vp: number; reason: string }
  | { t: 'gameEnd'; winner: PlayerId | 'draw'; vp: [number, number] }
  | { t: 'note'; text: string };

// ─── Engine ─────────────────────────────────────────────────────────────────────

export class IllegalActionError extends Error {
  constructor(
    message: string,
    readonly violations: Violation[] = [],
  ) {
    super(message);
    this.name = 'IllegalActionError';
  }
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

export interface NewGameOptions {
  /** When true, units start in reserve and players alternate deploying regiments and faction terrain. */
  deploy?: boolean;
}

export interface Engine {
  readonly scenario: Scenario;
  /** A new game with both armies set up on the battlefield (or in deployment phase if `options.deploy` is true). */
  newGame(seed: number, options?: NewGameOptions): GameState;
  /** The pending decision, or null when the game has ended. */
  decision(state: GameState): Decision | null;
  /** What `unit` may do under the current `main` or `fightPick` decision ([] if nothing). */
  unitOptions(state: GameState, unit: UnitId): UnitOption[];
  /** Legal targets per weapon for `unit` shooting or fighting now. */
  targetOptions(state: GameState, unit: UnitId, mode: AttackMode): WeaponTargets[];
  /** Checks a placement against the current `place` decision. Cheap enough to call per drag. */
  checkPlacement(state: GameState, placement: Placement): Violation[];
  /** Applies an action. Throws `IllegalActionError` if it is not legal now. */
  apply(state: GameState, action: Action): StepResult;
  /** An action that is always legal for the current decision (pass where possible). */
  defaultAction(state: GameState): Action;
}
