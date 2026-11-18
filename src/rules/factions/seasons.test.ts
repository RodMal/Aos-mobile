import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario, type GameState } from '../../engine/index.js';
import { editable, keepOnly, passTo, placeUnit, startGame } from '../../engine/test-helpers.js';
import {
  burgeoningOptions,
  burgeoningPick,
  creepingDreadCandidates,
  creepingDreadSurcharge,
  reapingBonus,
} from './seasons.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const named = (s: GameState, name: string) => Object.values(s.units).find((u) => u.name === name)!;

describe('Seasons Of War (owner, 2026-11-11)', () => {
  it('is asked at the start of each battle round, never last round’s season, and the NPC varies', () => {
    const s0 = engine.newGame(1);
    const d = engine.decision(s0)!;
    expect(d).toMatchObject({ kind: 'alarielleSeason', player: 0 });
    if (d.kind !== 'alarielleSeason') return;
    expect(d.seasons).toEqual(['burgeoning', 'reaping', 'dwindling', 'everdusk']);
    const s1 = engine.apply(s0, { t: 'choose', value: 'dwindling' }).state;
    expect(s1.alarielleSeason?.[1]).toBe('dwindling');
    // Round 2 offers every season but the Dwindling.
    let s = s1;
    while (engine.decision(s)?.kind !== 'alarielleSeason') {
      s = engine.apply(s, engine.defaultAction(s)).state;
    }
    expect(s.round).toBe(2);
    const d2 = engine.decision(s)!;
    if (d2.kind !== 'alarielleSeason') return;
    expect(d2.seasons).not.toContain('dwindling');
    expect(() => engine.apply(s, { t: 'choose', value: 'dwindling' })).toThrow(/last battle round/);
    // The NPC never repeats last round's pick.
    const npc = chooseAction(engine, s);
    expect(npc.t === 'choose' && npc.value).not.toBe('dwindling');
  });

  it('The Reaping adds 1 to casting rolls wholly within 12" of Alarielle', () => {
    const s = editable(startGame(engine, 1));
    const alarielle = named(s, 'Alarielle the Everqueen');
    const drycha = named(s, 'Drycha Hamadreth');
    s.alarielleSeason = { 1: 'reaping' };
    s.alarielleSeasonPlayer = 0;
    placeUnit(scenario, s, alarielle.id, 10, 22);
    placeUnit(scenario, s, drycha.id, 16, 22);
    expect(reapingBonus(scenario, s, drycha)).toBe(1);
    placeUnit(scenario, s, drycha.id, 40, 22);
    expect(reapingBonus(scenario, s, drycha)).toBe(0);
    s.alarielleSeason = { 1: 'burgeoning' };
    placeUnit(scenario, s, drycha.id, 16, 22);
    expect(reapingBonus(scenario, s, drycha)).toBe(0);
  });

  it('The Dwindling: Sylvaneth may charge after retreating and take no retreat damage', () => {
    const s = editable(startGame(engine, 1));
    const dryads = named(s, 'Dryads');
    const krox = named(s, 'Kroxigor');
    keepOnly(s, [dryads.id, krox.id]);
    placeUnit(scenario, s, dryads.id, 20, 22, 90);
    placeUnit(scenario, s, krox.id, 24, 22, 270);
    s.players[1].cp = 0;
    s.players[0].rageDice = 0;
    s.players[1].rageDice = 0;
    s.alarielleSeason = { 1: 'dwindling' };
    s.alarielleSeasonPlayer = 0;
    let m = passTo(engine, s, 'movement');
    m = engine.apply(m, { t: 'move', unit: dryads.id, kind: 'retreat' }).state;
    const away = {
      unit: dryads.id,
      models: m.units[dryads.id]!.models.map((md, i) => ({ i, x: md.x - 5, y: md.y, rot: md.rot })),
    };
    const r = engine.apply(m, { t: 'place', placement: away });
    expect(r.events.some((e) => e.t === 'damage' && e.unit === dryads.id)).toBe(false);
    let c = r.state;
    while (engine.decision(c)?.kind === 'reaction') c = engine.apply(c, { t: 'pass' }).state;
    c = passTo(engine, c, 'charge');
    expect(engine.unitOptions(c, dryads.id)).toContainEqual({ t: 'charge' });
  });

  it('The Burgeoning lets Ever Growing reach the feature nearest the centre', () => {
    const s = editable(startGame(engine, 1));
    s.alarielleSeason = { 1: 'burgeoning' };
    s.alarielleSeasonPlayer = 0;
    const pick = burgeoningPick(scenario, s, 0, '0:terrain');
    expect(pick).toBeDefined();
    s.alarielleSeason = { 1: 'reaping' };
    expect(burgeoningPick(scenario, s, 0, '0:terrain')).toBeUndefined();
  });

  /** The start of round 1 with a second Awakened Wyldwood for player 0 on the battlefield. */
  function twoWyldwoods(): GameState {
    const s = editable(engine.newGame(1));
    const second = editable({ ...s, units: { x: s.units['0:terrain']! } }).units['x']!;
    second.id = '0:terrain2';
    second.name = 'Awakened Wyldwood (second)';
    s.units[second.id] = second;
    s.unitOrder.push(second.id);
    placeUnit(scenario, s, second.id, 60, 8);
    return s;
  }

  it('The Burgeoning offers the decision the player’s Wyldwoods and the features', () => {
    const s = twoWyldwoods();
    const d = engine.decision(s)!;
    if (d.kind !== 'alarielleSeason') throw new Error('expected the season decision');
    expect(d.wyldwoods.map((w) => w.id)).toEqual(['0:terrain', '0:terrain2']);
    expect(d.features).toEqual(
      burgeoningOptions(scenario, s, 0).map((f) => ({ id: f.id, name: f.name })),
    );
  });

  it('The Burgeoning: each Awakened Wyldwood names its own feature (owner, 2026-11-18)', () => {
    const s = twoWyldwoods();
    const d = engine.decision(s)!;
    if (d.kind !== 'alarielleSeason') throw new Error('expected the season decision');
    const [a, b] = [d.features.at(-1)!, d.features.at(-2)!];
    const r = engine.apply(s, {
      t: 'choose',
      value: `burgeoning:0:terrain=${a.id},0:terrain2=${b.id}`,
    });
    expect(r.state.burgeoningChoices).toEqual({ '0:terrain': a.id, '0:terrain2': b.id });
    expect(r.state.overgrown?.[0]).toContain(a.id);
    expect(r.state.overgrown?.[0]).toContain(b.id);
    // Only the Wyldwood that is named picks a feature of its own: the other takes the default.
    const one = engine.apply(s, { t: 'choose', value: `burgeoning:0:terrain2=${b.id}` });
    expect(one.state.overgrown?.[0]).toContain(b.id);
    expect(() => engine.apply(s, { t: 'choose', value: 'burgeoning:0:terrain=nowhere' })).toThrow();
    expect(() => engine.apply(s, { t: 'choose', value: 'burgeoning:nowhere=outcrop-w' })).toThrow();
    expect(() => engine.apply(s, { t: 'choose', value: `reaping:0:terrain=${a.id}` })).toThrow();
  });

  it('The Burgeoning without picks: each Wyldwood takes the next feature closest to the centre', () => {
    const s = twoWyldwoods();
    const r = engine.apply(s, { t: 'choose', value: 'burgeoning' });
    const gained = (r.state.overgrown?.[0] ?? []).filter((id) => !s.overgrown?.[0]?.includes(id));
    expect(gained).toHaveLength(2);
    expect(new Set(gained).size).toBe(2);
    // The first Wyldwood's pick is the single-pick default.
    const s1 = editable(s);
    s1.alarielleSeason = { 1: 'burgeoning' };
    s1.alarielleSeasonPlayer = 0;
    expect(gained[0]).toBe(burgeoningPick(scenario, s1, 0, '0:terrain'));
  });
});

describe('Enemy faction terrain as an overgrowth target (owner, 2026-11-18, I73)', () => {
  /** A state with the opponent's faction terrain on the battlefield and nothing else near it. */
  function withEnemyTerrain(): GameState {
    const s = editable(engine.newGame(1));
    expect(s.units['1:terrain']).toBeDefined();
    s.units['1:terrain']!.status = 'battlefield';
    placeUnit(scenario, s, '1:terrain', 40, 22);
    s.overgrown = [[], []];
    return s;
  }

  it('The Burgeoning may name the enemy faction terrain when no enemy unit controls it', () => {
    const s = withEnemyTerrain();
    keepOnly(s, ['0:terrain', '1:terrain']);
    expect(burgeoningOptions(scenario, s, 0).map((f) => f.id)).toContain('1:terrain');
    const r = engine.apply(s, { t: 'choose', value: 'burgeoning:0:terrain=1:terrain' });
    expect(r.state.overgrown?.[0]).toContain('1:terrain');
  });

  it('is not an option while an enemy unit controls it', () => {
    const s = withEnemyTerrain();
    const guard = Object.values(s.units).find((u) => u.owner === 1 && u.armyIndex >= 0)!;
    keepOnly(s, ['0:terrain', '1:terrain', guard.id]);
    placeUnit(scenario, s, guard.id, 40, 26);
    expect(burgeoningOptions(scenario, s, 0).map((f) => f.id)).not.toContain('1:terrain');
  });
});
describe('Creeping Dread (owner, 2026-11-11)', () => {
  /** Player 0 in their hero phase, an enemy unit in the creeping overgrowth. */
  function inOvergrowth(): { s: GameState; foe: string } {
    const s = editable(startGame(engine, 1));
    s.overgrown = [scenario.battlefield.terrain.map((t) => t.id), []];
    const foe = named(s, 'Saurus Warriors').id;
    const hero = named(s, 'Lord Kroak').id;
    keepOnly(s, [named(s, 'Dryads').id, foe, hero, '0:terrain']);
    placeUnit(scenario, s, foe, 30, 6);
    placeUnit(scenario, s, hero, 55, 40); // far from the target
    return { s, foe };
  }

  it('is offered at the start of a turn; up to 3 targets under Everdusk; pass declines', () => {
    const { s, foe } = inOvergrowth();
    s.stack = [{ t: 'creepingDread', player: 0, units: [foe], max: 1 }];
    expect(engine.decision(s)).toEqual({ kind: 'creepingDread', player: 0, units: [foe], max: 1 });
    expect(engine.defaultAction(s)).toEqual({ t: 'pass' });
    expect(() => engine.apply(s, { t: 'choose', value: 'nope' })).toThrow();
    const used = engine.apply(s, { t: 'choose', value: foe }).state;
    expect(used.creepingDread).toEqual({ player: 0, targets: [foe], spent: [] });
    expect(chooseAction(engine, s)).toEqual({ t: 'choose', value: foe });
  });

  it('never offers a HERO as a target (owner, 2026-11-12), on screen or for the NPC', () => {
    const { s, foe } = inOvergrowth();
    const kroak = named(s, 'Lord Kroak').id;
    placeUnit(scenario, s, kroak, 34, 6); // in the overgrowth too
    s.unitOrder.forEach((id) => {
      const u = s.units[id]!;
      if (u.name === 'Skink Starseer') {
        u.status = 'battlefield';
        u.models.forEach((m) => (m.alive = true));
        placeUnit(scenario, s, id, 26, 6);
      }
    });
    const candidates = creepingDreadCandidates(scenario, s, 0);
    expect(candidates).toContain(foe);
    expect(candidates).not.toContain(kroak);
    expect(candidates.map((id) => s.units[id]!.name)).not.toContain('Skink Starseer');
    // The start-of-turn decision (what the prompt lists and the NPC picks from) is the same.
    s.stack = [{ t: 'creepingDread', player: 0, units: candidates, max: 3 }];
    expect(() => engine.apply(s, { t: 'choose', value: kroak })).toThrow();
    const a = chooseAction(engine, s);
    expect(a.t === 'choose' && a.value.split(',')).not.toContain(kroak);
  });

  it('the first command for the target costs 1 more CP unless it is wholly within 12" of a Hero', () => {
    const { s, foe } = inOvergrowth();
    s.creepingDread = { player: 0, targets: [foe], spent: [] };
    const unit = s.units[foe]!;
    expect(creepingDreadSurcharge(scenario, s, unit)).toBe(1);
    placeUnit(scenario, s, named(s, 'Lord Kroak').id, 30, 10); // a Hero close by
    expect(creepingDreadSurcharge(scenario, s, unit)).toBe(0);
    s.creepingDread = { player: 0, targets: [foe], spent: [foe] };
    placeUnit(scenario, s, named(s, 'Lord Kroak').id, 55, 40);
    expect(creepingDreadSurcharge(scenario, s, unit)).toBe(0);
  });
});
