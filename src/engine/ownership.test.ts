import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  type Action,
  type GameState,
} from './index.js';
import { editable, keepOnly, passTo, placeUnit } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

function unitNamed(s: GameState, name: string) {
  return Object.values(s.units).find((u) => u.name === name)!;
}

function expectIllegal(s: GameState, action: Action) {
  expect(() => engine.apply(s, action)).toThrow(IllegalActionError);
}

describe('ownership of acting units', () => {
  it('the active player cannot Rally or use Magical Intervention with enemy units', () => {
    const s = editable(engine.newGame(1));
    expect(s.active).toBe(0);
    const krox = unitNamed(s, 'Kroxigor');
    krox.damage = 1;
    krox.models[0]!.alive = false;
    expectIllegal(s, { t: 'command', command: 'rally', unit: krox.id });
    const kroak = unitNamed(s, 'Lord Kroak');
    expectIllegal(s, { t: 'command', command: 'magicalIntervention', unit: kroak.id });
    expect(engine.unitOptions(s, krox.id)).toEqual([]);
  });

  it('rejects move, shoot, charge and ability actions naming an enemy unit', () => {
    const s = editable(engine.newGame(1));
    const enemy = unitNamed(s, 'Saurus Warriors');
    const mv = passTo(engine, s, 'movement');
    expectIllegal(mv, { t: 'move', unit: enemy.id, kind: 'normal' });
    const sh = passTo(engine, s, 'shooting');
    expectIllegal(sh, { t: 'shoot', unit: enemy.id, allocations: [] });
    const ch = passTo(engine, s, 'charge');
    expectIllegal(ch, { t: 'charge', unit: enemy.id });
    expectIllegal(s, { t: 'ability', unit: enemy.id, abilityId: 'place-of-power' });
  });

  it('the active player cannot use Eruption of Fury with an enemy unit or spend its rage', () => {
    const s = editable(engine.newGame(1));
    const belthanos = unitNamed(s, 'Belthanos, First Thorn of Kurnoth');
    const krox = unitNamed(s, 'Kroxigor');
    keepOnly(s, [belthanos.id, krox.id]);
    placeUnit(scenario, s, belthanos.id, 30, 22);
    placeUnit(scenario, s, krox.id, 34.5, 22, 270);
    s.players[0].rageDice = 2;
    s.players[1].rageDice = 2;
    s.active = 1;
    s.firstPlayer = 1;
    s.phase = 'end';
    expect(s.active).toBe(1);
    expectIllegal(s, { t: 'ability', unit: belthanos.id, abilityId: 'eruption-of-fury' });
    // Its own unit is fine, and only an engaged enemy may be the target.
    const ok = engine.apply(s, { t: 'ability', unit: krox.id, abilityId: 'eruption-of-fury' });
    expect(ok.state.players[0].rageDice).toBe(2);
    expect(ok.state.players[1].rageDice).toBe(0);
    expectIllegal(s, {
      t: 'ability',
      unit: krox.id,
      abilityId: 'eruption-of-fury',
      target: krox.id,
    });
  });
});
