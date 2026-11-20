import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario } from '../../engine/index.js';
import {
  editable,
  keepOnly,
  passTo,
  placeUnit,
  skipWindows,
  startGame,
} from '../../engine/test-helpers.js';
import { fightWord } from './fightStatus.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const BASTILADON = '1:7';

describe('fightWord', () => {
  it('is "fighting" from the pick to the end of the attacks, then "fought"', () => {
    const s = editable(startGame(engine, 1));
    keepOnly(s, ['0:0', BASTILADON]);
    placeUnit(scenario, s, '0:0', 20, 22, 90);
    placeUnit(scenario, s, BASTILADON, 23.5, 22, 270);
    s.players[0].cp = 3;
    s.players[1].cp = 0;
    s.players[0].rageDice = 0;
    s.players[1].rageDice = 0;
    // The defender's Ark of Sotek is offered in the start-of-combat window (R14): passed here.
    let t = editable(skipWindows(engine, passTo(engine, s, 'combat')));
    t.units['0:0']!.fought = true;
    expect(fightWord(t, t.units[BASTILADON]!)).toBe('');
    const seen: string[] = [];
    for (let i = 0; i < 12 && t.phase === 'combat'; i++) {
      t = engine.apply(t, engine.defaultAction(t)).state;
      const w = fightWord(t, t.units[BASTILADON]!);
      if (seen[seen.length - 1] !== w) seen.push(w);
    }
    expect(seen).toEqual(['fighting', 'fought']);
  });
});
