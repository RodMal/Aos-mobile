/**
 * The order of end-of-turn abilities (task B4; docs/RULES-DECISIONS.md I111; Core 13.0, 31.0): the
 * active player's resolve first (Endless Growth, Huntmaster's Strike, Vengeance of Azyr), then the
 * other player's, and only then objective control and scoring.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, type GameState } from './index.js';
import { editable, keepOnly, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const BELTHANOS = '0:1';
const DURTHU = '0:2';
const SAURUS = '1:5';
const outcrop = scenario.battlefield.terrain.find((t) => t.id === 'outcrop-w')!;

/**
 * Durthu (a Monster, so Nature's Titans heals it 3) stands in the creeping overgrowth with 9
 * damage, in combat with Saurus Warriors; Belthanos charged this turn. End phase, `active` to move.
 */
function endOfTurn(active: 0 | 1): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, [BELTHANOS, DURTHU, SAURUS]);
  s.overgrown = [[outcrop.id], []];
  placeUnit(scenario, s, DURTHU, outcrop.centre[0], outcrop.centre[1]);
  placeUnit(scenario, s, SAURUS, outcrop.centre[0], outcrop.centre[1]);
  placeUnit(scenario, s, BELTHANOS, 8, 8);
  s.units[DURTHU]!.damage = 9;
  s.units[BELTHANOS]!.charged = true;
  s.active = active;
  s.turnIndex = 0;
  s.phase = 'end';
  s.stack = [];
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return s;
}

describe('end-of-turn abilities resolve for the active player first (I111)', () => {
  it('Sylvaneth active: the heal and Huntmaster come before the Vengeance of Azyr prompt', () => {
    const s = endOfTurn(0);
    expect(s.units[DURTHU]!.damage).toBe(9);
    const first = engine.apply(s, { t: 'pass' }).state;
    // Endless Growth has already healed Durthu, and Huntmaster's Strike is the question.
    expect(first.units[DURTHU]!.damage).toBe(6);
    expect(engine.decision(first)).toMatchObject({ kind: 'reaction', player: 0 });
    const second = engine.apply(first, { t: 'pass' }).state;
    expect(engine.decision(second)).toMatchObject({ kind: 'vengeance', player: 1, stage: 'pick' });
    expect(second.active).toBe(0);
    const done = engine.apply(second, { t: 'choose', value: 'none' }).state;
    expect(done.active).toBe(1);
  });

  it('Seraphon active: Vengeance of Azyr first, then the heal and Huntmaster', () => {
    const s = endOfTurn(1);
    const first = engine.apply(s, { t: 'pass' }).state;
    expect(engine.decision(first)).toMatchObject({ kind: 'vengeance', player: 1, stage: 'pick' });
    expect(first.units[DURTHU]!.damage).toBe(9);
    const second = engine.apply(first, { t: 'choose', value: 'none' }).state;
    expect(second.units[DURTHU]!.damage).toBe(6);
    expect(engine.decision(second)).toMatchObject({ kind: 'reaction', player: 0 });
    const done = engine.apply(second, { t: 'pass' }).state;
    expect(done.active).toBe(0);
  });

  it('the NPC and defaultAction get through the end of either turn', () => {
    for (const active of [0, 1] as const) {
      for (const pick of ['npc', 'default'] as const) {
        let s = endOfTurn(active);
        for (let i = 0; i < 12 && s.active === active && s.status !== 'ended'; i++) {
          const action = pick === 'default' ? engine.defaultAction(s) : chooseAction(engine, s);
          s = engine.apply(s, action).state;
        }
        expect(s.active, `${pick}, active ${active}`).toBe(1 - active);
      }
    }
  });
});
