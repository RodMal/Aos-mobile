import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario, type GameState } from '../../engine/index.js';
import { editable, keepOnly, passTo, placeUnit, startGame } from '../../engine/test-helpers.js';
import { burgeoningPick, creepingDreadSurcharge, reapingBonus } from './seasons.js';

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
    const pick = burgeoningPick(scenario, s, 0);
    expect(pick).toBeDefined();
    s.alarielleSeason = { 1: 'reaping' };
    expect(burgeoningPick(scenario, s, 0)).toBeUndefined();
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
