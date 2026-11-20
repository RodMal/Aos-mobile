/**
 * M4j: the NPC uses Hidden Hunters and Chameleon Ambush only when they help its plan (I108): it
 * holds one Hunters unit back in ambush, and brings it in from round 2 at an objective it does
 * not hold (round 3 anywhere legal, as the unit is destroyed at the start of round 4).
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { CHAMELEON_AMBUSH_ID, HIDDEN_HUNTERS_ID } from '../engine/abilities/seraphon.js';
import { createEngine, createScenario, type GameState } from '../engine/index.js';
import { editable } from '../engine/test-helpers.js';
import { chooseAction } from './baseline.js';

const scenario = createScenario([SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN]);
const engine = createEngine(scenario);
const HUNTERS = '0:8';
const OTHER_HUNTERS = '0:9';

/** Plays the deployment with the NPC's own choices until the battle begins. */
function npcDeployment(): { state: GameState; ambushed: string[] } {
  let s = engine.newGame(3, { deploy: true });
  const ambushed: string[] = [];
  for (let i = 0; i < 300; i++) {
    const d = engine.decision(s);
    if (!d) break;
    if (d.kind === 'main' || d.kind === 'priority' || d.kind === 'fugitive') break;
    const a = chooseAction(engine, s);
    if (a.t === 'ability' && a.abilityId === HIDDEN_HUNTERS_ID) ambushed.push(a.unit);
    s = engine.apply(s, a).state;
  }
  return { state: s, ambushed };
}

describe('Hidden Hunters (NPC)', () => {
  it('holds one Hunters unit back in ambush and deploys the other', () => {
    const { state, ambushed } = npcDeployment();
    expect(ambushed).toEqual([HUNTERS]);
    expect(state.units[HUNTERS]).toMatchObject({ status: 'reserve', inAmbush: true });
    expect(state.units[OTHER_HUNTERS]!.status).toBe('battlefield');
  });
});

describe('Chameleon Ambush (NPC)', () => {
  function inMovement(round: number): GameState {
    const s = editable(npcDeployment().state);
    s.stack = [];
    s.round = round;
    s.active = 0;
    s.phase = 'movement';
    return s;
  }

  it('is not used in round 1', () => {
    const s = inMovement(1);
    expect(chooseAction(engine, s)).not.toMatchObject({ abilityId: CHAMELEON_AMBUSH_ID });
  });

  it('is used from round 2 when a legal spot at an objective it does not hold exists, and then sets the unit up', () => {
    const s = inMovement(2);
    const a = chooseAction(engine, s);
    expect(a).toMatchObject({ t: 'ability', unit: HUNTERS, abilityId: CHAMELEON_AMBUSH_ID });
    const declared = engine.apply(s, a).state;
    const place = chooseAction(engine, declared);
    expect(place.t).toBe('place');
    const after = engine.apply(declared, place).state;
    expect(after.units[HUNTERS]).toMatchObject({ status: 'battlefield', inAmbush: false });
  });

  it('is not used while no unit waits in ambush', () => {
    const s = inMovement(2);
    s.units[HUNTERS]!.inAmbush = false;
    expect(chooseAction(engine, s)).not.toMatchObject({ abilityId: CHAMELEON_AMBUSH_ID });
  });
});
