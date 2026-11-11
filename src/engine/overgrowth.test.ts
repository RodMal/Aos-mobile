import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { applyEverGrowing } from '../rules/factions/sylvaneth.js';
import { legalTargetsForSpec } from './abilities/effects.js';
import {
  createEngine,
  createScenario,
  inCreepingOvergrowth,
  overgrownTokenIds,
  type GameState,
} from './index.js';
import { editable, keepOnly, placeUnit } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const REALMSHAPER = '1:terrain';
const terrain = (id: string) => scenario.battlefield.terrain.find((t) => t.id === id)!;

function named(s: GameState, name: string) {
  return Object.values(s.units).find((u) => u.name === name)!;
}

/** A game with only the listed units on the battlefield (faction terrain included). */
function arena(ids: string[]): GameState {
  const s = editable(engine.newGame(1));
  if (!s.units[WYLDWOOD]) {
    const reserve = engine.newGame(1, { deploy: true });
    for (const id of [WYLDWOOD, REALMSHAPER]) {
      s.units[id] = { ...reserve.units[id]!, status: 'battlefield' };
      s.unitOrder.push(id);
    }
  }
  for (const id of [WYLDWOOD, REALMSHAPER]) s.units[id]!.status = 'battlefield';
  keepOnly(s, ids);
  s.overgrown = [[], []];
  return s;
}

describe('Ever Growing (Awakened Wyldwood)', () => {
  it('gives the closest terrain feature without a friendly token a token, with no range cap', () => {
    const s = arena([WYLDWOOD]);
    // 4" below the west outcrop; the south ruin is next closest.
    placeUnit(scenario, s, WYLDWOOD, 22, 23.5);
    applyEverGrowing(scenario, s);
    expect(s.overgrown![0]).toEqual(['outcrop-w']);
    // Next round: outcrop-w already has one, so the next closest is picked.
    applyEverGrowing(scenario, s);
    expect(s.overgrown![0]).toHaveLength(2);
    expect(s.overgrown![0]).toContain('outcrop-w');
  });

  it('gives no token when the opponent controls the closest feature', () => {
    const s = arena([WYLDWOOD, '1:1']);
    placeUnit(scenario, s, WYLDWOOD, 22, 23.5);
    const o = terrain('outcrop-w');
    placeUnit(scenario, s, '1:1', o.centre[0], o.centre[1] - 4);
    const notes = applyEverGrowing(scenario, s);
    expect(s.overgrown![0]).toEqual([]);
    expect(notes.join(' ')).toMatch(/controlled by the opponent/);
  });

  it('only Awakened Wyldwoods use it: the Seraphon Realmshaper Engine spreads nothing', () => {
    const s = arena([REALMSHAPER]);
    placeUnit(scenario, s, REALMSHAPER, 50, 30);
    applyEverGrowing(scenario, s);
    expect(s.overgrown).toEqual([[], []]);
    expect(overgrownTokenIds(scenario, s, 1)).toEqual([]);
  });

  it('tokens are per player: a Sylvaneth token gives the other army no overgrowth', () => {
    const s = arena([WYLDWOOD, '1:1']);
    placeUnit(scenario, s, WYLDWOOD, 8, 17);
    const o = terrain('outcrop-w');
    placeUnit(scenario, s, '1:1', o.centre[0], o.centre[1]);
    s.overgrown = [['outcrop-w'], []];
    expect(inCreepingOvergrowth(scenario, s, s.units['1:1']!, 0)).toBe(true);
    expect(inCreepingOvergrowth(scenario, s, s.units['1:1']!, 1)).toBe(false);
    expect(overgrownTokenIds(scenario, s, 0).sort()).toEqual([WYLDWOOD, 'outcrop-w'].sort());
  });
});

describe('creeping overgrowth range', () => {
  it('scales with the token count: 8" away is out with 2 tokens and in with 3', () => {
    const s = arena(['1:1']);
    const o = terrain('outcrop-e');
    const krox = s.units['1:1']!;
    // A point 8.5" below the outcrop's lowest corner, measured from the nearest base edge.
    const bottom = Math.max(...o.polygon.map((p) => p[1]));
    placeUnit(scenario, s, krox.id, o.centre[0], bottom + 9.5);
    s.overgrown = [['outcrop-e', 'ruin-nw'], []];
    expect(inCreepingOvergrowth(scenario, s, krox, 0)).toBe(false);
    s.overgrown = [['outcrop-e', 'ruin-nw', 'ruin-n'], []];
    expect(inCreepingOvergrowth(scenario, s, krox, 0)).toBe(true);
    // 8 tokens (7 terrain features and the far-off Realmshaper Engine): 12", so a unit next
    // to the south-east ruin, which has no token, is out.
    s.units[REALMSHAPER]!.status = 'battlefield';
    placeUnit(scenario, s, REALMSHAPER, 50, 5);
    const seven = scenario.battlefield.terrain.map((t) => t.id).filter((id) => id !== 'ruin-se');
    s.overgrown = [[...seven, REALMSHAPER], []];
    placeUnit(scenario, s, krox.id, 55, 40);
    expect(inCreepingOvergrowth(scenario, s, krox, 0)).toBe(false);
    // A 9th token, from a Wyldwood far away: the whole battlefield, so the unit is in.
    s.units[WYLDWOOD]!.status = 'battlefield';
    placeUnit(scenario, s, WYLDWOOD, 4, 12);
    expect(overgrownTokenIds(scenario, s, 0)).toHaveLength(9);
    expect(inCreepingOvergrowth(scenario, s, krox, 0)).toBe(true);
  });

  it('spells use the scaled range, and Song Of Dread needs the target wholly within it', () => {
    const s = arena(['0:5', '1:1']);
    const warsong = named(s, 'Warsong Revenant');
    expect(warsong.id).toBe('0:5');
    placeUnit(scenario, s, warsong.id, 5, 40);
    const o = terrain('outcrop-e');
    const bottom = Math.max(...o.polygon.map((p) => p[1]));
    const krox = s.units['1:1']!;
    placeUnit(scenario, s, krox.id, o.centre[0], bottom + 9.5);
    s.overgrown = [['outcrop-e', 'ruin-nw', 'ruin-n'], []];
    const within = { side: 'enemy' as const, range: 18, allowCreepingOvergrowth: true };
    expect(legalTargetsForSpec(scenario, s, warsong, within).map((u) => u.id)).toEqual([krox.id]);
    expect(
      legalTargetsForSpec(scenario, s, warsong, { ...within, creepingOvergrowthWholly: true }),
    ).toEqual([]);
  });
});
