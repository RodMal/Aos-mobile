/** R21 (I92): the Eruption of Fury target choice counts Alarielle's Song's -1 to ward rolls. */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, type GameState } from '../engine/index.js';
import { editable, keepOnly, placeUnit, startGame } from '../engine/test-helpers.js';
import { eruptionAction } from './baseline.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WARSONG = '0:5';
const ATTACKER = '0:1'; // Belthanos;
const KROAK = '1:0'; // Ward (4+), save 4+
const OTHER = '1:7'; // Bastiladon: no ward, save 2+

function pick(kroakX: number): string {
  const s: GameState = editable(startGame(engine, 1));
  const at: Record<string, [number, number]> = {
    [WARSONG]: [30, 22],
    [ATTACKER]: [30, 28],
    [KROAK]: [kroakX, 22],
    [OTHER]: [30, 45],
  };
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y]] of Object.entries(at)) placeUnit(scenario, s, id, x, y);
  const a = eruptionAction(engine, s, s.units[ATTACKER]!, {
    t: 'ability',
    targets: [KROAK, OTHER],
  } as never);
  return (a as { target: string }).target;
}

describe("Eruption of Fury and Alarielle's Song", () => {
  it('prefers a different target when the Song worsens a ward', () => {
    expect(pick(60)).toBe(OTHER);
    expect(pick(40)).toBe(KROAK);
  });
});
