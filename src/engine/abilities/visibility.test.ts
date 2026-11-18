import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario, type GameState, type UnitId } from '../index.js';
import { isUnitObscured } from '../terrain.js';
import { editable, keepOnly, placeUnit, startGame } from '../test-helpers.js';

// Owner's ruling I75 (2026-11-18): a targeted spell, prayer or ability needs its target to be
// visible, except where range is measured from the creeping overgrowth.
const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

type Pt = [number, number];
/** Beside spire-w (Obscuring): a lone model here is hidden from units 3" or more away. */
const HIDDEN: Pt = [10, 28];
/** The same row, more than 1" from the spire: visible. */
const SEEN: Pt = [15, 28];

const DRYADS = '0:6'; // friendly target for Sylvaneth, enemy target for Seraphon
const HUNTERS = '1:8'; // enemy target for Sylvaneth, friendly target for Seraphon
const SYLVANETH_IDS = ['0:0', '0:3', '0:5', '0:6'];
const SERAPHON_IDS = ['1:0', '1:6', '1:8'];

function arena(casterId: UnitId, targetId: UnitId, at: Pt, caster: Pt = [20, 28]): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, [casterId, targetId]);
  s.overgrown = [[], []];
  s.units[targetId]!.models.forEach((m, i) => (m.alive = i === 0));
  placeUnit(scenario, s, targetId, at[0], at[1]);
  placeUnit(scenario, s, casterId, caster[0], caster[1]);
  s.players[0].cp = 4;
  s.players[1].cp = 4;
  const owner = s.units[casterId]!.owner;
  s.active = owner;
  return s;
}

function optionTargets(s: GameState, caster: UnitId, abilityId: string): string[] {
  const o = engine
    .unitOptions(s, caster)
    .find((x) => x.t === 'ability' && x.abilityId === abilityId);
  return o && o.t === 'ability' ? o.targets : [];
}

/** The unit among `candidates` that is offered `abilityId` against `target` at `at`. */
function findCaster(abilityId: string, candidates: string[], target: UnitId, at: Pt) {
  return candidates.find(
    (c) => c !== target && optionTargets(arena(c, target, at), c, abilityId).includes(target),
  );
}

// Every registered targeted spell and prayer; each printed text says "visible".
const CASES: [string, string, string[], UnitId][] = [
  ['Jade Thorns', '97df-e136-9fb4-5aca', SYLVANETH_IDS, DRYADS],
  ['Zephyrspite Rush', '4ea1-b08a-3684-8d35', SYLVANETH_IDS, DRYADS],
  ['Grasping Roots', '77cf-59bd-fc8e-f6c7', SYLVANETH_IDS, HUNTERS],
  ['Song Of The Lost', 'a865-102f-ce95-480c', SYLVANETH_IDS, DRYADS],
  ['Song Of Dread', '4c37-4bd5-f9d5-170a', SYLVANETH_IDS, HUNTERS],
  ['Song Of War', '1b5b-a2e8-6dd3-17fb', SYLVANETH_IDS, DRYADS],
  ['Metamorphosis', 'b4bf-ef71-9dfe-e837', SYLVANETH_IDS, HUNTERS],
  ['Enrage The Spites', 'a924-fd6e-9278-4d4c', SYLVANETH_IDS, HUNTERS],
  ["Comet's Call", '78d-5a7e-a6c9-7674', SERAPHON_IDS, DRYADS],
  ['Mystical Unforging', 'e0c2-6f59-3b19-9e51', SERAPHON_IDS, DRYADS],
  ['Speed of Huanchi', '6086-ce9b-38be-28b2', SERAPHON_IDS, HUNTERS],
  ['Celestial Deliverance', 'f7bf-5a9-2828-a74', SERAPHON_IDS, DRYADS],
  ['Celestial Doom', '2209-9b15-d3f-15ed', SERAPHON_IDS, DRYADS],
];

describe('visibility for targeted spells and prayers (I75)', () => {
  it.each(CASES)('%s needs a visible target', (_name, id, casters, target) => {
    const caster = findCaster(id, casters, target, SEEN);
    expect(caster, 'offered against a visible target').toBeDefined();
    const hidden = arena(caster!, target, HIDDEN);
    expect(isUnitObscured(scenario, hidden, hidden.units[target]!)).toBe(true);
    expect(optionTargets(hidden, caster!, id)).not.toContain(target);
  });

  it('Song Of Dread: a target in the creeping overgrowth needs no visibility', () => {
    // Warsong is far outside 18" of the hidden Hunters, but they are wholly within the
    // creeping overgrowth (every terrain feature has a token).
    const s = arena('0:5', HUNTERS, HIDDEN, [40, 28]);
    s.overgrown = [scenario.battlefield.terrain.map((t) => t.id), []];
    expect(isUnitObscured(scenario, s, s.units[HUNTERS]!)).toBe(true);
    expect(optionTargets(s, '0:5', '4c37-4bd5-f9d5-170a')).toContain(HUNTERS);
  });

  it('Enrage The Spites (awaiting the owner): the 12" branch needs visibility, the overgrowth branch does not', () => {
    const id = 'a924-fd6e-9278-4d4c';
    const s = arena('0:3', HUNTERS, HIDDEN, [20, 28]);
    expect(optionTargets(s, '0:3', id)).not.toContain(HUNTERS); // within 12", hidden
    s.overgrown = [scenario.battlefield.terrain.map((t) => t.id), []];
    expect(optionTargets(s, '0:3', id)).toContain(HUNTERS); // in the overgrowth
  });
});
