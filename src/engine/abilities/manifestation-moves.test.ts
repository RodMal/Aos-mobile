/** M4k: the movement abilities of the Pendulum, the Purple Sun and the Gravetide (S13). */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import {
  createEngine,
  createScenario,
  currentPlacement,
  manifestationUnitId,
  shiftPlacement,
  type Action,
  type Engine,
  type GameEvent,
  type GameState,
  type Placement,
  type Scenario,
  type UnitId,
} from '../index.js';
import { passedAcross } from '../sweep.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from '../test-helpers.js';

const ALARIELLE = '0:0';
const DRYADS = '0:6';
const DRYADS_2 = '0:7';
const DURTHU = '0:2';
const KROAK = '1:0';
const KROXIGOR = '1:1';
const SAURUS_GUARD = '1:3';
const STARSEER = '1:6';
const HUNTERS = '1:8';

const SUMMON_PENDULUM = '678b-96e1-66bb-1de8';
const SUMMON_PURPLE_SUN = '1b29-60f4-48d2-a6bb';
const SUMMON_GRAVETIDE = '36e0-4b94-aeb-67ac';
const WS_PENDULUM = 'fcb6-ae80-2e58-aadb';
const WS_PURPLE_SUN = 'e7a5-e611-4c13-22d0';
const WS_GRAVETIDE = '1885-a1aa-bf5d-6d0d';

const PENDULUM = manifestationUnitId(0, WS_PENDULUM);
const SUN = manifestationUnitId(1, WS_PURPLE_SUN);
const GRAVETIDE = manifestationUnitId(1, WS_GRAVETIDE);

interface World {
  scenario: Scenario;
  engine: Engine;
}

/** The game as it is, or with the manifestations' Move set to `move` (room to cross units). */
function world(move?: number): World {
  const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
  if (move !== undefined) {
    for (const ws of [WS_PENDULUM, WS_PURPLE_SUN, WS_GRAVETIDE]) {
      scenario.profiles[ws] = { ...scenario.profiles[ws]!, move };
    }
  }
  return { scenario, engine: createEngine(scenario) };
}

/**
 * `caster` summons the manifestation, which is then put at (x, y) with blade angle `rot`;
 * it is the owner's movement phase and the manifestation may move. The other units start far
 * away; tests place them.
 */
function inPlay(
  w: World,
  others: UnitId[],
  caster: UnitId,
  summon: string,
  id: UnitId,
  at: { x: number; y: number; rot?: number },
): GameState {
  const { scenario, engine } = w;
  const owner = caster === ALARIELLE ? 0 : 1;
  const s0 = editable(startGame(engine, 1));
  keepOnly(s0, [caster, ...others]);
  for (const p of s0.players) {
    p.cp = 0;
    p.rageDice = 0;
  }
  placeUnit(scenario, s0, caster, 20, 5);
  others.forEach((u, k) => placeUnit(scenario, s0, u, 60, 5 + k * 6));
  s0.active = owner;
  s0.phase = 'hero';
  s0.stack = [];
  let s = applyUntil(engine, s0, { t: 'ability', unit: caster, abilityId: summon }, (r) =>
    r.events.some((e) => e.t === 'cast' && e.success),
  ).state;
  for (let i = 0; i < 12; i++) {
    const d = engine.decision(s);
    if (!d || d.kind === 'main') break;
    s = engine.apply(s, engine.defaultAction(s)).state;
  }
  s = editable(s);
  s.phase = 'movement';
  s.stack = [];
  s.units[caster]!.moved = 'normal'; // the caster has moved: the NPC turns to the manifestation
  const m = s.units[id]!;
  m.setUpThisTurn = false;
  m.moved = null;
  placeUnit(scenario, s, id, at.x, at.y, at.rot ?? 0);
  m.models[0]!.rot = at.rot ?? 0;
  return s;
}

/** Puts a unit at (x, y) with only its first model left: a small target. */
function lone(w: World, s: GameState, id: UnitId, x: number, y: number): void {
  const u = s.units[id]!;
  u.models.forEach((m, i) => {
    if (i > 0) m.alive = false;
  });
  placeUnit(w.scenario, s, id, x, y);
}

function shifted(s: GameState, id: UnitId, dx: number, dy: number): Placement {
  return shiftPlacement(currentPlacement(s.units[id]!), dx, dy);
}

/** Declares the normal move, then places it. */
function move(
  w: World,
  s: GameState,
  id: UnitId,
  placement: Placement,
  rng: number,
): { state: GameState; events: GameEvent[] } {
  const declared = w.engine.apply({ ...s, rng }, { t: 'move', unit: id, kind: 'normal' });
  const placed = w.engine.apply(declared.state, { t: 'place', placement });
  return { state: placed.state, events: [...declared.events, ...placed.events] };
}

/** Violations of a placement, once the move is declared. */
function check(w: World, s: GameState, id: UnitId, placement: Placement): string[] {
  const declared = w.engine.apply(s, { t: 'move', unit: id, kind: 'normal' }).state;
  return w.engine.checkPlacement(declared, placement).map((v) => `${v.code}: ${v.message}`);
}

const rolls = (events: GameEvent[], label: string): number[][] =>
  events.flatMap((e) => (e.t === 'roll' && e.label === label ? [e.dice] : []));
const damage = (events: GameEvent[], source: string): number[] =>
  events.flatMap((e) => (e.t === 'damage' && e.source === source ? [e.amount] : []));

/** The events of the move under the first RNG state for which `accept` holds. */
function seedWhere(
  w: World,
  s: GameState,
  id: UnitId,
  placement: Placement,
  accept: (events: GameEvent[]) => boolean,
): GameEvent[] {
  for (let rng = 1; rng < 500; rng++) {
    const r = move(w, s, id, placement, rng);
    if (accept(r.events)) return r.events;
  }
  throw new Error('no RNG state gave the wanted outcome');
}

describe('Aethervoid Pendulum (M4k)', () => {
  const w = world();
  const arena = (others: UnitId[] = [SAURUS_GUARD]): GameState =>
    inPlay(w, others, ALARIELLE, SUMMON_PENDULUM, PENDULUM, { x: 4, y: 22 });

  it('The Pendulum Swings (9ec5-1011-c05e-5045): moves in a straight line along its blade, either way, and keeps its blade', () => {
    const s = arena();
    expect(w.engine.unitOptions(s, PENDULUM)).toEqual([
      { t: 'move', kind: 'normal', allowance: 8 },
    ]);
    expect(check(w, s, PENDULUM, shifted(s, PENDULUM, 6, 0))).toEqual([]);
    expect(check(w, s, PENDULUM, shifted(s, PENDULUM, 4, 4)).join()).toContain('straight line');
    expect(check(w, s, PENDULUM, shifted(s, PENDULUM, 0, 5)).join()).toContain('straight line');
    const turned = shifted(s, PENDULUM, 6, 0);
    turned.models[0]!.rot = 40;
    expect(check(w, s, PENDULUM, turned).join()).toContain('straight line');
    // The other way along the blade, and a blade that points across the board.
    const mid = inPlay(w, [SAURUS_GUARD], ALARIELLE, SUMMON_PENDULUM, PENDULUM, {
      x: 14,
      y: 22,
      rot: 90,
    });
    expect(check(w, mid, PENDULUM, shifted(mid, PENDULUM, 0, 6))).toEqual([]);
    expect(check(w, mid, PENDULUM, shifted(mid, PENDULUM, 0, -6))).toEqual([]);
    expect(check(w, mid, PENDULUM, shifted(mid, PENDULUM, 6, 0)).join()).toContain('straight line');
  });

  it('The Pendulum Swings: cannot charge or fight', () => {
    const s = arena();
    lone(w, s, SAURUS_GUARD, 8, 22);
    s.phase = 'charge';
    expect(w.engine.unitOptions(s, PENDULUM)).toEqual([]);
    s.phase = 'combat';
    expect(w.engine.unitOptions(s, PENDULUM)).toEqual([]);
  });

  it('Scything Blade (54d0-e6a1-c6e8-46a7): passes through models, then D6 mortal damage on 2+', () => {
    const s = arena();
    lone(w, s, SAURUS_GUARD, 8, 22);
    const to = shifted(s, PENDULUM, 8, 0);
    expect(check(w, s, PENDULUM, to)).toEqual([]);
    expect(passedAcross(w.scenario, s, s.units[PENDULUM]!, to).map((u) => u.id)).toEqual([
      SAURUS_GUARD,
    ]);
    const hit = seedWhere(w, s, PENDULUM, to, (ev) => damage(ev, 'Scything Blade').length > 0);
    const roll = rolls(hit, 'Scything Blade');
    expect(roll).toHaveLength(1);
    expect(roll[0]![0]).toBeGreaterThanOrEqual(2);
    expect(damage(hit, 'Scything Blade')).toEqual([roll[0]![0]]);
    const miss = seedWhere(w, s, PENDULUM, to, (ev) => rolls(ev, 'Scything Blade')[0]?.[0] === 1);
    expect(damage(miss, 'Scything Blade')).toEqual([]);
  });

  it('Scything Blade: up to 3 enemy units passed across', () => {
    const big = world(40);
    const four = [SAURUS_GUARD, KROXIGOR, STARSEER, HUNTERS];
    const s = inPlay(big, four, ALARIELLE, SUMMON_PENDULUM, PENDULUM, { x: 4, y: 22 });
    four.forEach((u, k) => lone(big, s, u, 9 + k * 5, 22));
    const to = shifted(s, PENDULUM, 24, 0);
    expect(passedAcross(big.scenario, s, s.units[PENDULUM]!, to)).toHaveLength(4);
    expect(check(big, s, PENDULUM, to)).toEqual([]);
    const r = move(big, s, PENDULUM, to, 5);
    expect(rolls(r.events, 'Scything Blade')).toHaveLength(3);
  });

  it('Scything Blade: also targets an enemy unit within 1/2" of the end of the move', () => {
    const s = arena();
    // Beside the end of the move (12, 22), clear of the path.
    lone(w, s, SAURUS_GUARD, 12, 23.95);
    const to = shifted(s, PENDULUM, 8, 0);
    const unit = s.units[PENDULUM]!;
    expect(passedAcross(w.scenario, s, unit, to)).toEqual([]);
    expect(passedAcross(w.scenario, s, unit, to, 0.5).map((u) => u.id)).toEqual([SAURUS_GUARD]);
    expect(rolls(move(w, s, PENDULUM, to, 2).events, 'Scything Blade')).toHaveLength(1);
    // Further away: not a target.
    lone(w, s, SAURUS_GUARD, 12, 25);
    expect(rolls(move(w, s, PENDULUM, to, 2).events, 'Scything Blade')).toHaveLength(0);
  });

  it('Scything Blade: can end the move in combat, and can be used from combat', () => {
    const s = arena();
    lone(w, s, SAURUS_GUARD, 14.2, 22);
    expect(check(w, s, PENDULUM, shifted(s, PENDULUM, 8, 0))).toEqual([]);
    const fighting = arena();
    lone(w, fighting, SAURUS_GUARD, 6.5, 22.5);
    expect(w.engine.unitOptions(fighting, PENDULUM)).toEqual([
      { t: 'move', kind: 'normal', allowance: 8 },
    ]);
  });

  it('the NPC moves the Pendulum along its blade across an enemy unit', () => {
    const s = arena();
    lone(w, s, SAURUS_GUARD, 8, 22);
    const a = chooseAction(w.engine, s) as Action;
    expect(a).toMatchObject({ t: 'move', unit: PENDULUM, kind: 'normal' });
    const declared = w.engine.apply(s, a).state;
    const b = chooseAction(w.engine, declared) as Action;
    expect(b.t).toBe('place');
    const done = w.engine.apply(declared, b);
    expect(rolls(done.events, 'Scything Blade')).toHaveLength(1);
  });
});

describe('Purple Sun of Shyish (M4k)', () => {
  const w = world(30);
  const arena = (others: UnitId[]): GameState =>
    inPlay(w, others, KROAK, SUMMON_PURPLE_SUN, SUN, { x: 4, y: 22 });

  it('End Given Form (42b5-c322-7e12-371c): passes through models, D3 mortal damage on 2+ to a unit passed across', () => {
    const s = arena([DRYADS]);
    lone(w, s, DRYADS, 8, 22);
    const to = shifted(s, SUN, 16, 0);
    expect(check(w, s, SUN, to)).toEqual([]);
    expect(passedAcross(w.scenario, s, s.units[SUN]!, to).map((u) => u.id)).toEqual([DRYADS]);
    const hit = seedWhere(w, s, SUN, to, (ev) => damage(ev, 'End Given Form').length > 0);
    const roll = rolls(hit, 'End Given Form');
    expect(roll).toHaveLength(1);
    expect(roll[0]![0]).toBeGreaterThanOrEqual(2);
    expect(roll[0]![0]).toBeLessThanOrEqual(3);
    expect(damage(hit, 'End Given Form')).toEqual([roll[0]![0]]);
    const one = seedWhere(w, s, SUN, to, (ev) => rolls(ev, 'End Given Form')[0]?.[0] === 1);
    expect(damage(one, 'End Given Form')).toEqual([]);
  });

  it('End Given Form: up to 3 enemy units passed across', () => {
    const big = world(40);
    const s = inPlay(big, [DRYADS, DRYADS_2, DURTHU, ALARIELLE], KROAK, SUMMON_PURPLE_SUN, SUN, {
      x: 4,
      y: 22,
    });
    lone(big, s, DRYADS, 10, 22);
    lone(big, s, DRYADS_2, 15, 22);
    placeUnit(big.scenario, s, DURTHU, 21, 22);
    placeUnit(big.scenario, s, ALARIELLE, 29, 22);
    const to = shifted(s, SUN, 34, 0);
    expect(passedAcross(big.scenario, s, s.units[SUN]!, to)).toHaveLength(4);
    expect(check(big, s, SUN, to)).toEqual([]);
    expect(rolls(move(big, s, SUN, to, 5).events, 'End Given Form')).toHaveLength(3);
  });

  it('End Given Form: cannot end the move in combat, but can pass through models', () => {
    const s = arena([DRYADS]);
    // Used from combat (3" or less from the enemy), it must end more than 3" away.
    lone(w, s, DRYADS, 8, 22);
    expect(check(w, s, SUN, shifted(s, SUN, 8, 0)).join()).toContain('ENEMY_COMBAT_RANGE');
    expect(check(w, s, SUN, shifted(s, SUN, 16, 0))).toEqual([]);
  });

  it('the NPC sweeps the Purple Sun across an enemy unit', () => {
    const s = arena([DRYADS]);
    lone(w, s, DRYADS, 8, 22);
    const a = chooseAction(w.engine, s) as Action;
    expect(a).toMatchObject({ t: 'move', unit: SUN, kind: 'normal' });
    const declared = w.engine.apply(s, a).state;
    const done = w.engine.apply(declared, chooseAction(w.engine, declared) as Action);
    expect(rolls(done.events, 'End Given Form')).toHaveLength(1);
  });
});

describe('Suffocating Gravetide (M4k)', () => {
  const big = world(40);
  const arena = (): GameState => {
    const s = inPlay(big, [DRYADS, DRYADS_2], KROAK, SUMMON_GRAVETIDE, GRAVETIDE, {
      x: 4,
      y: 22,
    });
    placeUnit(big.scenario, s, DRYADS, 14, 22);
    placeUnit(big.scenario, s, DRYADS_2, 14, 33);
    return s;
  };

  it('Pulled to the Grave (1fa3-5209-8869-8d58): a die per model in one passed-across unit, 5+ is 1 mortal damage', () => {
    const s = arena();
    const to = shifted(s, GRAVETIDE, 21, 0);
    expect(check(big, s, GRAVETIDE, to)).toEqual([]);
    expect(passedAcross(big.scenario, s, s.units[GRAVETIDE]!, to).map((u) => u.id)).toEqual([
      DRYADS,
    ]);
    const models = s.units[DRYADS]!.models.filter((m) => m.alive).length;
    const some = seedWhere(big, s, GRAVETIDE, to, (ev) =>
      rolls(ev, 'Pulled to the Grave')[0]!.some((d) => d >= 5),
    );
    const dice = rolls(some, 'Pulled to the Grave');
    expect(dice).toHaveLength(1);
    expect(dice[0]).toHaveLength(models);
    expect(damage(some, 'Pulled to the Grave')).toEqual([dice[0]!.filter((d) => d >= 5).length]);
    const none = seedWhere(big, s, GRAVETIDE, to, (ev) =>
      rolls(ev, 'Pulled to the Grave')[0]!.every((d) => d < 5),
    );
    expect(damage(none, 'Pulled to the Grave')).toEqual([]);
  });

  it('Pulled to the Grave: only one unit is picked, even when several were passed across', () => {
    const s = arena();
    placeUnit(big.scenario, s, DRYADS_2, 28, 22);
    const to = shifted(s, GRAVETIDE, 34, 0);
    expect(check(big, s, GRAVETIDE, to)).toEqual([]);
    expect(passedAcross(big.scenario, s, s.units[GRAVETIDE]!, to)).toHaveLength(2);
    expect(rolls(move(big, s, GRAVETIDE, to, 3).events, 'Pulled to the Grave')).toHaveLength(1);
  });

  it('Pulled to the Grave: cannot end the move in combat', () => {
    const s = arena();
    expect(check(big, s, GRAVETIDE, shifted(s, GRAVETIDE, 6, 0)).join()).toContain(
      'ENEMY_COMBAT_RANGE',
    );
  });

  it('the NPC sweeps the Gravetide across an enemy unit', () => {
    const s = arena();
    const a = chooseAction(big.engine, s) as Action;
    expect(a).toMatchObject({ t: 'move', unit: GRAVETIDE, kind: 'normal' });
  });
});

describe('Scything Blade in the enemy movement phase (M4o)', () => {
  const w = world();
  const SCYTHING = '54d0-e6a1-c6e8-46a7';
  const phaseOver = (s: GameState): GameState => w.engine.apply(s, { t: 'pass' }).state;
  const isOffer = (s: GameState): boolean => {
    const d = w.engine.decision(s);
    return d?.kind === 'reaction' && d.trigger === 'phase:movement';
  };

  /** The Pendulum's owner (player 0) waits while player 1 ends its movement phase. */
  const enemyTurn = (): GameState => {
    const s = inPlay(w, [SAURUS_GUARD], ALARIELLE, SUMMON_PENDULUM, PENDULUM, { x: 4, y: 22 });
    lone(w, s, SAURUS_GUARD, 8, 22);
    s.active = 1;
    s.units[ALARIELLE]!.moved = null;
    s.reactionsOffered = [];
    return s;
  };

  it('is offered to the Pendulum owner when the enemy ends its movement phase, once', () => {
    const s = phaseOver(enemyTurn());
    expect(w.engine.decision(s)).toMatchObject({
      kind: 'reaction',
      player: 0,
      trigger: 'phase:movement',
      options: [{ ability: 'scythingBlade', unit: PENDULUM, cost: 0 }],
    });
    // Passing it does not offer it again.
    expect(isOffer(phaseOver(s))).toBe(false);
  });

  it('is not offered when the Pendulum has moved this turn, or on its owner own turn', () => {
    const moved = enemyTurn();
    moved.units[PENDULUM]!.moved = 'normal';
    expect(isOffer(phaseOver(moved))).toBe(false);
    const own = enemyTurn();
    own.active = 0;
    expect(isOffer(phaseOver(own))).toBe(false);
  });

  it('moves in a straight line along the blade, with the same damage as on its own turn', () => {
    const offer = phaseOver(enemyTurn());
    const used = w.engine.apply(
      { ...offer, rng: 2 },
      { t: 'ability', unit: PENDULUM, abilityId: SCYTHING },
    );
    expect(w.engine.decision(used.state)).toMatchObject({
      kind: 'place',
      unit: PENDULUM,
      allowance: 8,
    });
    expect(
      w.engine.checkPlacement(used.state, shifted(used.state, PENDULUM, 4, 4)).length,
    ).toBeGreaterThan(0);
    const to = shifted(used.state, PENDULUM, 8, 0);
    expect(w.engine.checkPlacement(used.state, to)).toEqual([]);
    const done = w.engine.apply(used.state, { t: 'place', placement: to });
    const dice = rolls(done.events, 'Scything Blade');
    expect(dice).toHaveLength(1);
    const roll = dice[0]![0]!;
    expect(damage(done.events, 'Scything Blade')).toEqual(roll >= 2 ? [roll] : []);
    expect(done.state.units[PENDULUM]!.moved).toBe('normal');
    // Not offered a second time in the same phase.
    expect(isOffer(done.state)).toBe(false);
  });

  describe('together with Redeploy in one window', () => {
    const both = (): GameState => {
      const s = enemyTurn();
      s.players[0].cp = 3;
      return phaseOver(s);
    };
    const kinds = (s: GameState): string[] => {
      const d = w.engine.decision(s);
      return d?.kind === 'reaction' && d.trigger === 'phase:movement'
        ? d.options.map((o) => `${o.command ?? o.ability}:${o.unit}`)
        : [];
    };
    const redeploy: Action = { t: 'command', command: 'redeploy', unit: ALARIELLE };
    const blade: Action = { t: 'ability', unit: PENDULUM, abilityId: SCYTHING };
    const finishMove = (s: GameState): GameState => {
      const d = w.engine.decision(s);
      expect(d).toMatchObject({ kind: 'place' });
      const from = s.units[(d as { unit: UnitId }).unit]!;
      const placement = shiftPlacement(currentPlacement(from), 0.5, 0);
      return w.engine.apply(s, { t: 'place', placement }).state;
    };

    it('(a) both are offered together', () => {
      expect(kinds(both())).toEqual([`redeploy:${ALARIELLE}`, `scythingBlade:${PENDULUM}`]);
    });

    it('(b) after Redeploy, Scything Blade is still offered', () => {
      const s = finishMove(w.engine.apply(both(), redeploy).state);
      expect(kinds(s)).toEqual([`scythingBlade:${PENDULUM}`]);
    });

    it('(c) after Scything Blade, Redeploy is still offered', () => {
      const s = finishMove(w.engine.apply(both(), blade).state);
      expect(kinds(s)).toEqual([`redeploy:${ALARIELLE}`]);
    });

    it('(d) passing ends both', () => {
      const s = phaseOver(both());
      expect(kinds(s)).toEqual([]);
      expect(w.engine.decision(s)).not.toMatchObject({ kind: 'reaction' });
    });
  });

  it('the NPC uses it when the move crosses an enemy unit, and not otherwise', () => {
    expect(chooseAction(w.engine, phaseOver(enemyTurn()))).toMatchObject({
      t: 'ability',
      unit: PENDULUM,
      abilityId: SCYTHING,
    });
    const far = enemyTurn();
    lone(w, far, SAURUS_GUARD, 40, 5);
    expect(chooseAction(w.engine, phaseOver(far))).toEqual({ t: 'pass' });
  });
});
