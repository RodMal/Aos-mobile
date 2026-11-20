/**
 * Sylvaneth commands (task M4e): Fury of The Forest, The Land Awakens, The Goddess Of Life.
 * Printed text in data/factions/sylvaneth.json; interpretations in docs/RULES-DECISIONS.md.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { strikeOrder } from './abilities/effects.js';
import { createEngine, createScenario, type GameState } from './index.js';
import { goddessOfLifeUnits } from './eligibility.js';
import { formPlacement } from './query.js';
import type { Placement, UnitId } from './types.js';
import { editable, keepOnly, passTo, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const named = (s: GameState, owner: 0 | 1, name: string) =>
  Object.values(s.units).find((u) => u.owner === owner && u.name === name)!;

/** A legal set-up for the unit being placed, found on a grid around the Wyldwood. */
function legalSetUp(s: GameState, id: UnitId): Placement | null {
  const w = s.units[WYLDWOOD]!.models[0]!;
  for (let r = 0; r <= 14; r += 2) {
    for (let a = 0; a < 360; a += 30) {
      const x = w.x + Math.cos((a * Math.PI) / 180) * r;
      const y = w.y + Math.sin((a * Math.PI) / 180) * r;
      const p = formPlacement(scenario, s.units[id]!, { x, y }, 0);
      if (engine.checkPlacement(s, p).length === 0) return p;
    }
  }
  return null;
}

/** Player 0's units in play (the Wyldwood and the named ones), the enemy Kroxigor far away. */
function arranged(keep: string[], phase: 'movement' | 'end' | 'shooting'): GameState {
  const s = editable(startGame(engine, 1));
  const krox = named(s, 1, 'Kroxigor').id;
  keepOnly(s, [WYLDWOOD, krox, ...keep.map((n) => named(s, 0, n).id)]);
  placeUnit(scenario, s, WYLDWOOD, 30, 22);
  placeUnit(scenario, s, krox, 58, 40);
  s.active = 0;
  s.phase = phase;
  s.stack = [];
  s.players[0].cp = 4;
  s.players[1].cp = 4;
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return s;
}

function destroy(s: GameState, id: UnitId): void {
  s.units[id]!.status = 'destroyed';
  for (const m of s.units[id]!.models) m.alive = false;
}

describe('Fury of The Forest (081a-ebf2-6a79-c4db)', () => {
  /** The enemy Kroxigor stands in combat with Dryads; it is the enemy's turn, shooting phase. */
  function combatStart(opts: { twoEnemies?: boolean; outside?: boolean } = {}): GameState {
    const s = arranged(['Dryads'], 'shooting');
    const dryads = named(s, 0, 'Dryads');
    const krox = named(s, 1, 'Kroxigor');
    s.units[krox.id]!.status = 'battlefield';
    const at = opts.outside ? { x: 8, y: 8 } : { x: 30, y: 24 };
    placeUnit(scenario, s, dryads.id, at.x, at.y, 90);
    placeUnit(scenario, s, krox.id, at.x + 4, at.y, 270);
    if (opts.twoEnemies) {
      const other = named(s, 1, 'Saurus Guard');
      s.units[other.id]!.status = 'battlefield';
      for (const m of s.units[other.id]!.models) m.alive = true;
      placeUnit(scenario, s, other.id, at.x - 4, at.y, 90);
    }
    s.active = 1;
    return s;
  }

  it('is offered at the start of the enemy combat phase and gives Strike-first for the rest of the turn', () => {
    const s0 = combatStart();
    const dryads = named(s0, 0, 'Dryads').id;
    expect(strikeOrder(scenario, s0, s0.units[dryads]!)).toBe('normal');
    const s = passTo(engine, s0, 'combat');
    const d = engine.decision(s)!;
    expect(d.kind).toBe('reaction');
    if (d.kind !== 'reaction') return;
    expect(d.player).toBe(0);
    expect(d.options).toEqual([{ command: 'furyOfTheForest', unit: dryads, cost: 1 }]);
    const r = engine.apply(s, { t: 'command', command: 'furyOfTheForest', unit: dryads });
    expect(r.state.players[0].cp).toBe(s.players[0].cp - 1);
    expect(strikeOrder(scenario, r.state, r.state.units[dryads]!)).toBe('strikeFirst');
    // It lasts the rest of the turn.
    expect(r.state.effects?.some((e) => e.targetUnit === dryads && e.expires === 'turn')).toBe(
      true,
    );
    expect(engine.decision(r.state)?.kind).not.toBe('reaction');
  });

  it('may be declined, and costs nothing then', () => {
    const s = passTo(engine, combatStart(), 'combat');
    const r = engine.apply(s, { t: 'pass' });
    expect(r.state.players[0].cp).toBe(s.players[0].cp);
    expect(r.state.effects?.length ?? 0).toBe(0);
  });

  it('needs the unit in combat with only 1 enemy unit', () => {
    const s = passTo(engine, combatStart({ twoEnemies: true }), 'combat');
    expect(engine.decision(s)?.kind).not.toBe('reaction');
  });

  it('needs the unit wholly within the creeping overgrowth', () => {
    const s = passTo(engine, combatStart({ outside: true }), 'combat');
    expect(engine.decision(s)?.kind).not.toBe('reaction');
  });

  it('is not offered in your own combat phase', () => {
    const own = combatStart();
    own.active = 0;
    expect(engine.decision(passTo(engine, own, 'combat'))?.kind).not.toBe('reaction');
  });
});

describe('The Land Awakens (dcad-fc9a-65a3-b46f)', () => {
  const dryadsOf = (s: GameState) => named(s, 0, 'Dryads');
  const alarielle = (s: GameState) => named(s, 0, 'Alarielle the Everqueen');
  const awakens = (s: GameState, target?: UnitId) =>
    ({
      t: 'command',
      command: 'landAwakens',
      unit: alarielle(s).id,
      target: target ?? dryadsOf(s).id,
    }) as const;

  function lost(): GameState {
    const s = arranged(['Dryads', 'Alarielle the Everqueen'], 'end');
    placeUnit(scenario, s, alarielle(s).id, 30, 30);
    destroy(s, dryadsOf(s).id);
    return s;
  }

  it('is offered at the end of your turn for a destroyed Dryads unit only', () => {
    const s = lost();
    const isAwakens = (o: { t: string; command?: string }) =>
      o.t === 'command' && o.command === 'landAwakens';
    const opt = engine.unitOptions(s, alarielle(s).id).find(isAwakens);
    expect(opt).toMatchObject({ cost: 1 });
    // Spite-Revenants (non-Hero Revenant Infantry) and both Dryads; no Hero is a target.
    const targets = opt?.t === 'command' ? (opt.targets ?? []) : [];
    expect(targets.map((id) => s.units[id]!.name).sort()).toEqual([
      'Dryads',
      'Dryads',
      'Spite-Revenants',
    ]);
    const movement = { ...s, phase: 'movement' as const };
    expect(engine.unitOptions(movement, alarielle(s).id).some(isAwakens)).toBe(false);
  });

  it('sets up a replacement with half the models (rounded up) wholly within the overgrowth and more than 9" from enemies', () => {
    const s = lost();
    const d = dryadsOf(s);
    const total = d.models.length;
    const r = engine.apply(s, awakens(s));
    expect(r.state.players[0].cp).toBe(3);
    expect(engine.decision(r.state)).toMatchObject({
      kind: 'place',
      reason: 'replacement',
      unit: d.id,
    });
    const unit = r.state.units[d.id]!;
    expect(unit.models.filter((m) => m.alive)).toHaveLength(Math.ceil(total / 2));

    // Outside the creeping overgrowth: refused.
    const far = formPlacement(scenario, unit, { x: 8, y: 40 }, 0);
    expect(engine.checkPlacement(r.state, far).map((v) => v.message)).toContain(
      'Must be set up wholly within your creeping overgrowth.',
    );
    // Within the overgrowth but within 9" of an enemy: refused.
    const good = legalSetUp(r.state, d.id)!;
    expect(good).not.toBeNull();
    const near = editable(r.state);
    placeUnit(
      scenario,
      near,
      named(near, 1, 'Kroxigor').id,
      good.models[0]!.x + 5,
      good.models[0]!.y,
    );
    expect(engine.checkPlacement(near, good).map((v) => v.code)).toContain('ENEMY_COMBAT_RANGE');

    const done = engine.apply(r.state, { t: 'place', placement: good }).state;
    expect(done.units[d.id]!.status).toBe('battlefield');
    expect(done.units[d.id]!.damage).toBe(0);
    expect(done.units[d.id]!.models.filter((m) => m.alive)).toHaveLength(Math.ceil(total / 2));
  });

  it('is taken back, with its cost, when the set-up is cancelled', () => {
    const s = lost();
    const d = dryadsOf(s);
    const r = engine.apply(s, awakens(s));
    const back = engine.apply(r.state, { t: 'pass' }).state;
    expect(back.units[d.id]!.status).toBe('destroyed');
    expect(back.units[d.id]!.models.some((m) => m.alive)).toBe(false);
    expect(back.players[0].cp).toBe(4);
    expect(back.players[0].commandsUsed ?? []).toEqual([]);
    expect(back.stack).toHaveLength(0);
  });

  it('drops effects left on the destroyed unit when the replacement is placed', () => {
    const s = lost();
    const d = dryadsOf(s);
    s.effects = [
      {
        id: 'x',
        name: 'Old debuff',
        sourceUnit: d.id,
        targetUnit: d.id,
        owner: 1,
        expires: 'battle',
      },
    ];
    const r = engine.apply(s, awakens(s));
    const done = engine.apply(r.state, { t: 'place', placement: legalSetUp(r.state, d.id)! }).state;
    expect(done.effects?.some((e) => e.targetUnit === d.id) ?? false).toBe(false);
  });

  it('refuses a unit that is not destroyed, a Hero and an unaffordable use', () => {
    const alive = lost();
    alive.units[dryadsOf(alive).id]!.status = 'battlefield';
    expect(() => engine.apply(alive, awakens(alive))).toThrow();
    const s = lost();
    destroy(s, alarielle(s).id);
    s.units[alarielle(s).id]!.status = 'destroyed';
    expect(() =>
      engine.apply(s, { ...awakens(s, alarielle(s).id), unit: dryadsOf(s).id }),
    ).toThrow();
    const poor = lost();
    poor.players[0].cp = 0;
    expect(() => engine.apply(poor, awakens(poor))).toThrow();
  });
});

describe('The Goddess Of Life (4f7c-2ca1-ae3f-d2d3)', () => {
  function fallen(): GameState {
    const s = arranged(['Dryads', 'Alarielle the Everqueen'], 'movement');
    placeUnit(scenario, s, named(s, 0, 'Dryads').id, 30, 32);
    destroy(s, named(s, 0, 'Alarielle the Everqueen').id);
    return s;
  }
  const use = (st: GameState, unit?: UnitId) => {
    const a = named(st, 0, 'Alarielle the Everqueen').id;
    return engine.apply(st, {
      t: 'command',
      command: 'goddessOfLife',
      unit: unit ?? named(st, 0, 'Dryads').id,
      target: a,
    });
  };

  it('brings a destroyed Alarielle back in your movement phase with 8 damage points, no wards', () => {
    const s = fallen();
    const a = named(s, 0, 'Alarielle the Everqueen');
    const handle = named(s, 0, 'Dryads').id;
    const opt = engine
      .unitOptions(s, handle)
      .find((o) => o.t === 'command' && o.command === 'goddessOfLife');
    expect(opt).toMatchObject({ cost: 2, targets: [a.id] });
    const r = use(s);
    expect(r.state.players[0].cp).toBe(2);
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'replacement' });
    const spot = legalSetUp(r.state, a.id);
    expect(spot).not.toBeNull();
    const done = engine.apply(r.state, { t: 'place', placement: spot! });
    const unit = done.state.units[a.id]!;
    expect(unit.status).toBe('battlefield');
    expect(unit.damage).toBe(8);
    expect(unit.models.every((m) => m.alive)).toBe(true);
    // No ward rolls for those damage points.
    expect(done.events.some((e) => e.t === 'roll')).toBe(false);
    expect(done.state.players[0].goddessOfLifeUsed).toBe(true);
  });

  it('can be used once per battle, only in your own movement phase, for 2 CP', () => {
    const s = fallen();
    const used = editable(s);
    used.players[0].goddessOfLifeUsed = true;
    expect(() => use(used)).toThrow();
    const poor = editable(s);
    poor.players[0].cp = 1;
    expect(() => use(poor)).toThrow();
    const wrongPhase = editable(s);
    wrongPhase.phase = 'hero';
    expect(() => use(wrongPhase)).toThrow();
    const enemyTurn = editable(s);
    enemyTurn.active = 1;
    expect(() => use(enemyTurn)).toThrow();
  });

  it('is taken back, with the once-per-battle use, when the set-up is cancelled', () => {
    const s = fallen();
    const a = named(s, 0, 'Alarielle the Everqueen');
    const r = use(s, a.id);
    expect(r.state.players[0].goddessOfLifeUsed).toBe(true);
    const back = engine.apply(r.state, { t: 'pass' }).state;
    expect(back.players[0].goddessOfLifeUsed).toBeFalsy();
    expect(back.players[0].cp).toBe(4);
    expect(back.units[a.id]!.status).toBe('destroyed');
  });
});

describe('Replacement units (Core 24.2)', () => {
  const alarielleOf = (s: GameState) => named(s, 0, 'Alarielle the Everqueen');
  function replaced(): { s: GameState; id: UnitId } {
    const s = arranged(['Dryads', 'Alarielle the Everqueen'], 'end');
    placeUnit(scenario, s, alarielleOf(s).id, 30, 30);
    const d = named(s, 0, 'Dryads');
    destroy(s, d.id);
    d.abilitiesUsed = ['x'];
    d.castsUsed = 2;
    d.allOutAttack = true;
    d.damage = 1;
    s.effects = [
      { id: 'e', name: 'Old', sourceUnit: d.id, targetUnit: d.id, owner: 1, expires: 'battle' },
    ];
    const r = engine.apply(s, {
      t: 'command',
      command: 'landAwakens',
      unit: alarielleOf(s).id,
      target: d.id,
    });
    const done = engine.apply(r.state, { t: 'place', placement: legalSetUp(r.state, d.id)! });
    return { s: editable(done.state), id: d.id };
  }

  it('does not carry damage, tokens, abilities used or effects over to the replacement', () => {
    const { s, id } = replaced();
    const u = s.units[id]!;
    expect(u.status).toBe('battlefield');
    expect(u.damage).toBe(0);
    expect(u.abilitiesUsed).toBeUndefined();
    expect(u.castsUsed).toBeUndefined();
    expect(u.allOutAttack).toBeUndefined();
    expect(s.effects?.some((e) => e.targetUnit === id) ?? false).toBe(false);
  });

  it('a replacement unit that is destroyed again cannot be replaced by The Land Awakens', () => {
    const { s, id } = replaced();
    destroy(s, id);
    s.players[0].cp = 4;
    s.players[0].commandsUsed = [];
    const opt = engine
      .unitOptions(s, alarielleOf(s).id)
      .find((o) => o.t === 'command' && o.command === 'landAwakens');
    const targets = opt?.t === 'command' ? (opt.targets ?? []) : [];
    expect(targets).not.toContain(id);
    expect(() =>
      engine.apply(s, {
        t: 'command',
        command: 'landAwakens',
        unit: alarielleOf(s).id,
        target: id,
      }),
    ).toThrow();
  });

  it('Alarielle, brought back by The Goddess Of Life, cannot be replaced again', () => {
    const s = arranged(['Dryads', 'Alarielle the Everqueen'], 'movement');
    placeUnit(scenario, s, named(s, 0, 'Dryads').id, 30, 32);
    const a = alarielleOf(s);
    destroy(s, a.id);
    const r = engine.apply(s, {
      t: 'command',
      command: 'goddessOfLife',
      unit: named(s, 0, 'Dryads').id,
      target: a.id,
    });
    const done = editable(
      engine.apply(r.state, { t: 'place', placement: legalSetUp(r.state, a.id)! }).state,
    );
    destroy(done, a.id);
    // Even if the once-per-battle use were available again, a replaced unit is not a target.
    done.players[0].goddessOfLifeUsed = false;
    done.players[0].cp = 4;
    done.players[0].commandsUsed = [];
    expect(goddessOfLifeUnits(scenario, done, 0)).toEqual([]);
  });
});
