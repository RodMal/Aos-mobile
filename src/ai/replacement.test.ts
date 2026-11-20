/**
 * R8 (I99.5, I108): the NPC uses The Land Awakens and The Goddess Of Life when it helps its plan.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, type GameState, type UnitId } from '../engine/index.js';
import { editable, keepOnly, placeUnit, startGame } from '../engine/test-helpers.js';
import { chooseAction } from './baseline.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const named = (s: GameState, owner: 0 | 1, name: string) =>
  Object.values(s.units).find((u) => u.owner === owner && u.name === name)!;

/** Player 0 (the NPC here) has a Wyldwood, Dryads and Alarielle; the enemy is far away. */
function arranged(phase: 'movement' | 'end'): GameState {
  const s = editable(startGame(engine, 1));
  const krox = named(s, 1, 'Kroxigor').id;
  keepOnly(s, [
    WYLDWOOD,
    krox,
    named(s, 0, 'Dryads').id,
    named(s, 0, 'Alarielle the Everqueen').id,
  ]);
  // The Wyldwood stands on an objective, so the overgrowth reaches it.
  const o = scenario.battlefield.objectives[0]!;
  placeUnit(scenario, s, WYLDWOOD, o.x, o.y);
  placeUnit(scenario, s, krox, 58, 40);
  placeUnit(scenario, s, named(s, 0, 'Alarielle the Everqueen').id, 30, 30);
  placeUnit(scenario, s, named(s, 0, 'Dryads').id, 30, 34);
  s.active = 0;
  s.phase = phase;
  s.stack = [];
  s.round = 2;
  s.players[0].cp = 4;
  s.players[1].cp = 4;
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  for (const ob of s.objectives) ob.controller = null;
  return s;
}

function destroy(s: GameState, id: UnitId): void {
  s.units[id]!.status = 'destroyed';
  for (const m of s.units[id]!.models) m.alive = false;
}

describe('NPC: The Land Awakens', () => {
  it('brings back the destroyed unit, set up at a legal spot at an objective', () => {
    const s = arranged('end');
    destroy(s, named(s, 0, 'Dryads').id);
    const a = chooseAction(engine, s);
    expect(a).toMatchObject({ t: 'command', command: 'landAwakens' });
    const r = engine.apply(s, a);
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'replacement' });
    const p = chooseAction(engine, r.state);
    expect(p.t).toBe('place');
    const done = engine.apply(r.state, p);
    const unit = done.state.units[named(s, 0, 'Dryads').id]!;
    expect(unit.status).toBe('battlefield');
    expect(done.state.players[0].cp).toBe(3);
  });

  it('is skipped when CP are short', () => {
    const s = arranged('end');
    destroy(s, named(s, 0, 'Dryads').id);
    s.players[0].cp = 1;
    expect(chooseAction(engine, s)).not.toMatchObject({ command: 'landAwakens' });
  });

  it('is skipped when there is no creeping overgrowth to set it up in', () => {
    const s = arranged('end');
    destroy(s, named(s, 0, 'Dryads').id);
    destroy(s, WYLDWOOD);
    s.overgrown = [[], []];
    expect(chooseAction(engine, s)).not.toMatchObject({ command: 'landAwakens' });
  });

  it('is skipped in the last turn of the battle', () => {
    const s = arranged('end');
    destroy(s, named(s, 0, 'Dryads').id);
    s.round = scenario.rounds;
    s.firstPlayer = 1;
    expect(chooseAction(engine, s)).not.toMatchObject({ command: 'landAwakens' });
  });
});

describe('NPC: The Goddess Of Life', () => {
  it('brings Alarielle back in the movement phase once she is destroyed', () => {
    const s = arranged('movement');
    destroy(s, named(s, 0, 'Alarielle the Everqueen').id);
    const a = chooseAction(engine, s);
    expect(a).toMatchObject({ t: 'command', command: 'goddessOfLife' });
    const r = engine.apply(s, a);
    const p = chooseAction(engine, r.state);
    expect(p.t).toBe('place');
    const done = engine.apply(r.state, p);
    const al = done.state.units[named(s, 0, 'Alarielle the Everqueen').id]!;
    expect(al.status).toBe('battlefield');
    expect(al.damage).toBe(8);
  });

  it('is not used while she lives, or with 1 CP', () => {
    const s = arranged('movement');
    expect(chooseAction(engine, s)).not.toMatchObject({ command: 'goddessOfLife' });
    destroy(s, named(s, 0, 'Alarielle the Everqueen').id);
    s.players[0].cp = 1;
    expect(chooseAction(engine, s)).not.toMatchObject({ command: 'goddessOfLife' });
  });
});
