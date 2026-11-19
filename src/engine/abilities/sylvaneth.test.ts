/**
 * Sylvaneth passive abilities (M4d): Alarielle's Song, Terror Of The Deep Woods, One With The
 * Forest, Kurnothi War-horn, Battle Damaged (three warscrolls) and the Glamourweave artefact.
 * Readings: docs/RULES-DECISIONS.md I91 to I97.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { attackModifiers } from '../../rules/core/modifiers.js';
import { moveOf } from '../../rules/factions/seraphon.js';
import { rollAttackSequence, rollWard } from '../attack.js';
import { npcGlamourweaveReroll, pendingAttackDamage, usedWeapon } from '../combat.js';
import { moveOptions } from '../eligibility.js';
import {
  createEngine,
  createScenario,
  inCombat,
  type Action,
  type GameState,
  type StepResult,
  type UnitId,
} from '../index.js';
import { profileOf } from '../query.js';
import {
  ScriptedDice,
  editable,
  keepOnly,
  passTo,
  placeUnit,
  startGame,
  weapon,
} from '../test-helpers.js';
import { applyUntil } from '../test-helpers.js';
import { clearExpiredEffects, effectiveWard, unitGrants, wardRollModifier } from './effects.js';
import { chooseAction } from '../../ai/baseline.js';
import { glamourRerolls, spendGlamourweave } from './sylvaneth.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const ALARIELLE = '0:0';
const BELTHANOS = '0:1';
const DURTHU = '0:2';
const DRYCHA = '0:3';
const WARSONG = '0:5';
const DRYADS = '0:6';
const FAR_DRYADS = '0:7';
const ENEMY = '1:1';
const FAR_ENEMY = '1:2';

/** `ids` only, in the movement phase, at the given places. */
function arena(at: Record<string, [number, number]>): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y]] of Object.entries(at)) placeUnit(scenario, s, id, x, y);
  s.active = 0;
  for (const p of s.players) {
    p.cp = 0;
    p.rageDice = 0;
  }
  return s;
}

const unit = (s: GameState, id: UnitId) => s.units[id]!;

describe("Alarielle's Song (3f73-3ee4-8f6b-b16b)", () => {
  const s = arena({
    [WARSONG]: [30, 22],
    [DRYADS]: [30, 28],
    [FAR_DRYADS]: [30, 60],
    [ALARIELLE]: [10, 10],
    [ENEMY]: [40, 22],
    [FAR_ENEMY]: [10, 60],
  });

  it('gives Ward (6+) to friendly Sylvaneth wholly within 12", itself included', () => {
    expect(effectiveWard(scenario, s, unit(s, DRYADS))).toBe(6);
    expect(effectiveWard(scenario, s, unit(s, WARSONG))).toBe(6);
    expect(effectiveWard(scenario, s, unit(s, FAR_DRYADS))).toBeUndefined();
  });

  it('never worsens a better ward', () => {
    const t = arena({ [WARSONG]: [30, 22], [ALARIELLE]: [30, 28], [DRYADS]: [24, 22] });
    expect(unitGrants(scenario, t, unit(t, ALARIELLE)).ward).toBe(5);
    expect(unitGrants(scenario, t, unit(t, DRYADS)).ward).toBe(6);
  });

  it('subtracts 1 from the ward rolls of enemies within 12", and rollWard applies it', () => {
    expect(wardRollModifier(scenario, s, unit(s, ENEMY))).toBe(-1);
    expect(wardRollModifier(scenario, s, unit(s, FAR_ENEMY))).toBe(0);
    expect(wardRollModifier(scenario, s, unit(s, DRYADS))).toBe(0);
    // Ward 6+: an unmodified 6 saves, but with -1 it is a 5 and fails.
    expect(rollWard(new ScriptedDice([6]), 1, 6, 0).taken).toBe(0);
    expect(rollWard(new ScriptedDice([6]), 1, 6, -1).taken).toBe(1);
  });
});

describe('Terror Of The Deep Woods (a1f-39fd-6570-f3d5)', () => {
  it('bars enemies within 9" from running; beyond 9" they may run', () => {
    const near = arena({ [DRYCHA]: [20, 22], [ENEMY]: [30, 22], [FAR_ENEMY]: [55, 50] });
    expect(unitGrants(scenario, near, unit(near, ENEMY)).cannotRun).toBe(true);
    expect(
      moveOptions(scenario, near, unit(near, ENEMY)).map((o) => o.t === 'move' && o.kind),
    ).toEqual(['normal']);
    const far = moveOptions(scenario, near, unit(near, FAR_ENEMY)).map(
      (o) => o.t === 'move' && o.kind,
    );
    expect(far).toEqual(['normal', 'run']);
  });

  it('bars enemies in combat with it from retreating', () => {
    const s = arena({ [DRYCHA]: [20, 22], [ENEMY]: [24, 22] });
    expect(inCombat(scenario, s, unit(s, ENEMY))).toBe(true);
    expect(moveOptions(scenario, s, unit(s, ENEMY))).toEqual([]);
    // Without it the same unit may retreat.
    const without = arena({ [DURTHU]: [20, 22], [ENEMY]: [26, 22] });
    expect(inCombat(scenario, without, unit(without, ENEMY))).toBe(true);
    expect(
      moveOptions(scenario, without, unit(without, ENEMY)).map((o) => o.t === 'move' && o.kind),
    ).toEqual(['retreat']);
  });

  it('does not bind its own side', () => {
    const s = arena({ [DRYCHA]: [20, 22], [DRYADS]: [24, 22] });
    expect(unitGrants(scenario, s, unit(s, DRYADS)).cannotRun).toBeFalsy();
  });
});

describe('One With The Forest (f62f-75b0-48cd-101e)', () => {
  const outcrop = scenario.battlefield.terrain.find((t) => t.id === 'outcrop-w')!;
  const sit = (s: GameState) => ({
    attacker: unit(s, ENEMY),
    target: unit(s, DRYADS),
    weapon: weapon(),
    mode: 'fight' as const,
  });

  it('subtracts 1 from hit and wound rolls while the unit is wholly within the overgrowth', () => {
    const s = arena({ [DRYADS]: [outcrop.centre[0], outcrop.centre[1]], [ENEMY]: [10, 10] });
    s.overgrown = [['outcrop-w'], []];
    const mods = attackModifiers(scenario, s, sit(s));
    expect(mods).toContainEqual(expect.objectContaining({ stat: 'hit', value: -1 }));
    expect(mods).toContainEqual(expect.objectContaining({ stat: 'wound', value: -1 }));
  });

  it('does nothing outside the overgrowth, or when the unit is only partly within it', () => {
    const s = arena({ [DRYADS]: [outcrop.centre[0], outcrop.centre[1]], [ENEMY]: [10, 10] });
    s.overgrown = [[], []];
    expect(
      attackModifiers(scenario, s, sit(s)).filter((m) => m.source === 'One With The Forest'),
    ).toEqual([]);
    const t = arena({ [DRYADS]: [outcrop.centre[0], outcrop.centre[1] + 12], [ENEMY]: [10, 10] });
    t.overgrown = [['outcrop-w'], []];
    expect(
      attackModifiers(scenario, t, sit(t)).filter((m) => m.source === 'One With The Forest'),
    ).toEqual([]);
  });
});

describe('Kurnothi War-horn (59e8-f376-a5df-144c)', () => {
  it('adds 2" to the Move of Belthanos himself, the only Kurnothi in the list', () => {
    const s = arena({ [BELTHANOS]: [30, 22], [DRYADS]: [30, 28] });
    const base = profileOf(scenario, unit(s, BELTHANOS)).move;
    expect(moveOf(scenario, s, unit(s, BELTHANOS))).toBe(base + 2);
    const options = moveOptions(scenario, s, unit(s, BELTHANOS));
    expect(options.map((o) => o.t === 'move' && o.allowance)).toEqual([base + 2, base + 2]);
  });

  it('is not given to other units, or to Belthanos once he is gone', () => {
    const s = arena({ [BELTHANOS]: [30, 22], [DRYADS]: [30, 28] });
    expect(moveOf(scenario, s, unit(s, DRYADS))).toBe(profileOf(scenario, unit(s, DRYADS)).move);
    const gone = arena({ [DRYADS]: [30, 28] });
    expect(moveOf(scenario, gone, unit(gone, DRYADS))).toBe(
      profileOf(scenario, unit(gone, DRYADS)).move,
    );
  });

  it('is not given to an enemy unit', () => {
    const s = arena({ [BELTHANOS]: [30, 22], [ENEMY]: [35, 22] });
    expect(moveOf(scenario, s, unit(s, ENEMY))).toBe(profileOf(scenario, unit(s, ENEMY)).move);
  });
});

describe('Battle Damaged', () => {
  const cases: [string, UnitId, string, number][] = [
    ['135b-afc5-4fd9-3460', ALARIELLE, "Wardroth Beetle's Antlers", 4],
    ['c6b8-a8fd-b2-59fa', BELTHANOS, "Carnelian Greatspite's Mandibles", 3],
    ['2eb1-9bd5-1544-36d9', DURTHU, 'Guardian Sword', 3],
  ];
  for (const [id, who, name, attacks] of cases) {
    it(`${name} has ${attacks} Attacks from 10 damage points (${id})`, () => {
      const s = arena({ [who]: [30, 22] });
      const u = unit(s, who);
      expect(profileOf(scenario, u).abilities.some((a) => a.id === id)).toBe(true);
      const w = profileOf(scenario, u).weapons.find((x) => x.name.trim() === name)!;
      expect(usedWeapon(scenario, s, u, w).attacks).toEqual(w.attacks);
      u.damage = 9;
      expect(usedWeapon(scenario, s, u, w).attacks).toEqual(w.attacks);
      u.damage = 10;
      expect(usedWeapon(scenario, s, u, w).attacks).toEqual({ n: 0, sides: 0, plus: attacks });
      for (const other of profileOf(scenario, u).weapons.filter((x) => x.id !== w.id)) {
        expect(usedWeapon(scenario, s, u, other).attacks).toEqual(other.attacks);
      }
    });
  }
});

describe('Glamourweave (cafd-9cf1-871c-f47e)', () => {
  it('re-rolls the first failed hit, wound and save once each, and no second failure', () => {
    // 2 attacks, hit 4+, wound 4+, save 4+. Hits: 2 (fails) -> 5 re-roll; 3 (fails, none left).
    // Wound on the one hit: 1 (fails) -> 6 re-roll. Save: 2 (fails) -> 5 re-roll saves.
    const r = rollAttackSequence(new ScriptedDice([2, 5, 3, 1, 6, 2, 5]), {
      weapon: weapon({ attacks: { n: 0, sides: 0, plus: 2 } }),
      attacks: 2,
      mods: { hit: 0, wound: 0, save: 0, rend: 0, damage: 0 },
      target: { save: 4, ward: null },
      rerolls: { hit: true, wound: true, save: true },
    });
    expect(r).toMatchObject({
      hits: 1,
      wounds: 1,
      unsaved: 0,
      rerolled: { hit: true, wound: true, save: true },
    });
  });

  it('re-rolls the failed roll the player picks, not the first', () => {
    // 2 attacks, hit 4+. Hits: 2 (fails, kept) then 3 (fails) -> re-roll to 6. Wound 6, save 6.
    const asked: number[] = [];
    const r = rollAttackSequence(new ScriptedDice([2, 3, 6, 6, 6]), {
      weapon: weapon({ attacks: { n: 0, sides: 0, plus: 2 } }),
      attacks: 2,
      mods: { hit: 0, wound: 0, save: 0, rend: 0, damage: 0 },
      target: { save: 4, ward: null },
      rerolls: { hit: true },
      chooseReroll: (_kind, die) => {
        asked.push(die);
        return asked.length === 2;
      },
    });
    expect(asked).toEqual([2, 3]);
    expect(r.dice.hit).toEqual([2, 6]);
    expect(r.rerolled.hit).toBe(true);
  });

  it('is spent once per phase for the unit and returns at the end of the phase', () => {
    const s = arena({ [DURTHU]: [30, 22], [ENEMY]: [36, 22] });
    expect(glamourRerolls(scenario, s, unit(s, DURTHU), unit(s, ENEMY))).toEqual({
      hit: true,
      wound: true,
    });
    expect(glamourRerolls(scenario, s, unit(s, ENEMY), unit(s, DURTHU))).toEqual({ save: true });
    spendGlamourweave(s, unit(s, DURTHU), unit(s, ENEMY), { hit: true, wound: false, save: false });
    expect(glamourRerolls(scenario, s, unit(s, DURTHU), unit(s, ENEMY))).toEqual({ wound: true });
    spendGlamourweave(s, unit(s, ENEMY), unit(s, DURTHU), { hit: false, wound: false, save: true });
    expect(glamourRerolls(scenario, s, unit(s, ENEMY), unit(s, DURTHU))).toEqual({});
    clearExpiredEffects(s, 'phase');
    expect(glamourRerolls(scenario, s, unit(s, DURTHU), unit(s, ENEMY))).toEqual({
      hit: true,
      wound: true,
    });
  });

  it('is not given to the unit without the artefact', () => {
    const s = arena({ [ALARIELLE]: [30, 22], [ENEMY]: [36, 22] });
    expect(glamourRerolls(scenario, s, unit(s, ALARIELLE), unit(s, ENEMY))).toEqual({});
  });

  /** Durthu and the enemy in combat, at Durthu's fight with its targets to choose. */
  function durthuFights(): GameState {
    const base = arena({ [DURTHU]: [20, 22], [ENEMY]: [26, 22], [BELTHANOS]: [8, 8] });
    placeUnit(scenario, base, DURTHU, 20, 22, 90);
    placeUnit(scenario, base, ENEMY, 26, 22, 270);
    expect(inCombat(scenario, base, unit(base, DURTHU))).toBe(true);
    let s = passTo(engine, base, 'combat');
    s = engine.apply(s, { t: 'fight', unit: DURTHU }).state;
    return engine.apply(s, { t: 'pass' }).state; // no pile-in
  }

  const rerollOf = (s: GameState) => {
    const d = engine.decision(s);
    if (d?.kind !== 'reaction') return null;
    return d.options.find((o) => o.ability === 'glamourweave') ?? null;
  };
  const keep: Action = { t: 'pass' };
  const reroll = (u: UnitId): Action => ({ t: 'ability', unit: u, abilityId: 'glamourweave' });
  const spent = (s: GameState) => (s.effects ?? []).map((e) => e.id.split(':')[1]);
  /** Keeps every re-roll asked about until none is. */
  const keepAll = (r: StepResult): StepResult => {
    let x = r;
    for (let i = 0; i < 200 && rerollOf(x.state); i++) x = engine.apply(x.state, keep);
    expect(rerollOf(x.state)).toBeNull();
    return x;
  };

  it('asks the player at a failed hit roll; re-rolling spends it for the phase', () => {
    const s = durthuFights();
    const r = applyUntil(engine, s, engine.defaultAction(s), (x) => rerollOf(x.state) !== null);
    const d = engine.decision(r.state)!;
    expect(d.kind === 'reaction' && d.player).toBe(0);
    const option = rerollOf(r.state)!;
    expect(option.unit).toBe(DURTHU);
    expect(option.reroll).toMatchObject({ kind: 'hit', target: ENEMY });
    expect(option.reroll!.die).toBeLessThan(6);
    // Nothing is spent while the question is open.
    expect(spent(r.state)).toEqual([]);
    const after = engine.apply(r.state, reroll(DURTHU));
    expect(spent(after.state)).toContain('hit');
    expect(after.events.some((e) => e.t === 'note' && e.text.startsWith('Glamourweave'))).toBe(
      true,
    );
  });

  it('declining keeps the re-roll: the next failed roll is asked about, and keeping all spends none', () => {
    const s = durthuFights();
    for (let rng = 1; rng < 3000; rng++) {
      let x = engine.apply({ ...s, rng }, engine.defaultAction(s));
      if (!rerollOf(x.state)) continue;
      x = engine.apply(x.state, keep);
      const second = rerollOf(x.state);
      if (second?.reroll?.kind !== 'hit') continue;
      expect(spent(x.state)).toEqual([]); // still unspent
      x = keepAll(x);
      expect(spent(x.state)).toEqual([]);
      return;
    }
    throw new Error('no game asked twice');
  });

  it('keeping a roll and re-rolling a later one replays the same dice', () => {
    const s = durthuFights();
    for (let rng = 1; rng < 3000; rng++) {
      let x = engine.apply({ ...s, rng }, engine.defaultAction(s));
      if (!rerollOf(x.state)) continue;
      const first = rerollOf(x.state)!.reroll!.die;
      x = engine.apply(x.state, keep);
      if (rerollOf(x.state)?.reroll?.kind !== 'hit') continue;
      x = keepAll(engine.apply(x.state, reroll(DURTHU)));
      const attack = x.events.find((e) => e.t === 'attacks');
      expect(attack?.t === 'attacks' && attack.dice.hit).toContain(first);
      expect(spent(x.state)).toContain('hit');
      return;
    }
    throw new Error('no game asked twice');
  });

  it('a pause on the second weapon keeps the first weapon’s damage, applied once', () => {
    const s = durthuFights();
    const action = engine.defaultAction(s);
    expect(action.t === 'targets' && action.allocations.length).toBe(2);
    for (let rng = 1; rng < 3000; rng++) {
      const first = engine.apply({ ...s, rng }, action);
      // Paused after the first weapon has rolled (its attacks event is already out).
      if (!rerollOf(first.state) || !first.events.some((e) => e.t === 'attacks')) continue;
      let r = engine.apply(first.state, reroll(DURTHU));
      const events = [...first.events, ...r.events];
      r = keepAll({ ...r, events });
      const all = [...events, ...r.events.filter((e) => !events.includes(e))];
      const attacks = all.filter((e) => e.t === 'attacks');
      expect(attacks.map((e) => e.t === 'attacks' && e.weapon)).toEqual([
        'Guardian Sword',
        'Massive Impaling Talons',
      ]);
      const dealt = attacks.reduce((n, e) => n + (e.t === 'attacks' ? e.damage : 0), 0);
      const taken = all
        .filter((e) => e.t === 'damage' && e.unit === ENEMY)
        .reduce((n, e) => n + (e.t === 'damage' ? e.amount : 0), 0);
      expect(taken).toBe(dealt);
      return;
    }
    throw new Error('no game paused on the second weapon');
  });

  it("asks the owner of the target for a save re-roll on the opponent's attack", () => {
    let s = durthuFights();
    s = keepAll(engine.apply(s, engine.defaultAction(s))).state;
    s = editable(s);
    s.effects = []; // a fresh phase
    if (engine.decision(s)?.kind === 'fightPick') {
      s = engine.apply(s, { t: 'fight', unit: ENEMY }).state;
      s = engine.apply(s, { t: 'pass' }).state;
    }
    const r = applyUntil(
      engine,
      s,
      engine.defaultAction(s),
      (x) => rerollOf(x.state)?.reroll?.kind === 'save',
    );
    expect(rerollOf(r.state)!.unit).toBe(DURTHU);
    const d = engine.decision(r.state)!;
    expect(d.kind === 'reaction' && d.player).toBe(0);
  });

  /**
   * The NPC's answer at the first failed roll of `kind`, with the two weapons allocated in
   * either order: it re-rolls only when the attack being rolled has the most potential damage.
   */
  function npcAnswers(kind: 'hit' | 'wound' | 'save', start: GameState, attacker: UnitId) {
    const targets = engine.targetOptions(start, attacker, 'fight');
    const [wa, wb] = targets.map((w) => w.weaponId);
    const target = targets[0]!.targets[0]!.unit;
    const orders = [
      [wa!, wb!],
      [wb!, wa!],
    ];
    const answers: { reroll: boolean; first: number; second: number }[] = [];
    for (const order of orders) {
      const action: Action = {
        t: 'targets',
        allocations: order.map((weaponId) => ({ weaponId, target })),
      };
      let found: { reroll: boolean; first: number; second: number } | null = null;
      for (let rng = 1; rng < 3000 && !found; rng++) {
        const r = engine.apply({ ...start, rng }, action);
        const o = rerollOf(r.state);
        if (o?.reroll?.kind !== kind) continue;
        const top = r.state.stack[r.state.stack.length - 2]!;
        if (top.t !== 'resolve') continue;
        const [first, second] = pendingAttackDamage(scenario, r.state, top).map((p) => p.damage);
        const again = npcGlamourweaveReroll(scenario, r.state, o);
        // The NPC itself and the engine's default agree.
        const want: Action = again ? reroll(o.unit) : keep;
        expect(chooseAction(engine, r.state)).toEqual(want);
        expect(engine.defaultAction(r.state)).toEqual(want);
        found = { reroll: again, first: first!, second: second! };
      }
      expect(found).not.toBeNull();
      answers.push(found!);
    }
    return answers;
  }

  it('the NPC spends a hit re-roll on the attack with the most potential damage', () => {
    const [a, b] = npcAnswers('hit', durthuFights(), DURTHU);
    expect(a!.first).not.toBe(a!.second);
    expect(a!.reroll).toBe(a!.first >= a!.second);
    expect(b!.reroll).toBe(b!.first >= b!.second);
    expect(a!.reroll).not.toBe(b!.reroll);
  });

  it('the NPC spends a wound re-roll on the attack with the most potential damage', () => {
    const [a, b] = npcAnswers('wound', durthuFights(), DURTHU);
    expect(a!.reroll).toBe(a!.first >= a!.second);
    expect(b!.reroll).toBe(b!.first >= b!.second);
    expect(a!.reroll).not.toBe(b!.reroll);
  });

  it('the NPC spends a save re-roll against the attack with the most potential damage', () => {
    let s = durthuFights();
    s = keepAll(engine.apply(s, engine.defaultAction(s))).state;
    s = editable(s);
    s.effects = [];
    if (engine.decision(s)?.kind === 'fightPick') {
      s = engine.apply(s, { t: 'fight', unit: ENEMY }).state;
      s = engine.apply(s, { t: 'pass' }).state;
    }
    const [a, b] = npcAnswers('save', s, ENEMY);
    expect(a!.reroll).toBe(a!.first >= a!.second);
    expect(b!.reroll).toBe(b!.first >= b!.second);
    expect(a!.reroll).not.toBe(b!.reroll);
  });

  it('nothing is asked when no unit in the fight has the artefact', () => {
    const base = arena({ [ALARIELLE]: [20, 22], [ENEMY]: [26, 22] });
    placeUnit(scenario, base, ALARIELLE, 20, 22, 90);
    placeUnit(scenario, base, ENEMY, 26, 22, 270);
    let s = passTo(engine, base, 'combat');
    s = engine.apply(s, { t: 'fight', unit: ALARIELLE }).state;
    s = engine.apply(s, { t: 'pass' }).state;
    for (let rng = 1; rng < 200; rng++) {
      expect(rerollOf(engine.apply({ ...s, rng }, engine.defaultAction(s)).state)).toBeNull();
    }
  });
});
