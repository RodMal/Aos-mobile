/**
 * R12: the NPC uses Scry the Stars, Star-venom and Celestial Conduit only when they help its plan
 * (I108), judged by cheap distance and objective checks.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, type GameState } from '../engine/index.js';
import { editable, keepOnly, placeUnit, startGame } from '../engine/test-helpers.js';
import { SCRY_THE_STARS_ID } from '../engine/abilities/seraphon.js';
import { scryCandidates } from '../engine/seraphonActive.js';
import { chooseAction } from './baseline.js';
import {
  npcCoatlHelps,
  npcConduitHelps,
  npcScryPicks,
  npcScryWorthUsing,
  npcStarVenomTarget,
} from './seraphon.js';

const scenario = createScenario([SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN]);
const engine = createEngine(scenario);

const ASTROLITH = '0:4';
const WARRIORS = '0:5';
const STARSEER = '0:6';
const HUNTERS = '0:8';
const DRYADS = '1:6';

function arena(at: Record<string, [number, number]>, phase: GameState['phase']): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y]] of Object.entries(at)) placeUnit(scenario, s, id, x, y);
  s.active = 0;
  s.phase = phase;
  s.stack = [];
  s.round = 2;
  return s;
}

/** A spot at least `far` inches from every objective. */
function remoteSpot(far: number): [number, number] {
  const { width, height, objectives } = scenario.battlefield;
  for (let x = 4; x < width - 4; x += 2) {
    for (let y = 4; y < height - 4; y += 2) {
      if (objectives.every((o) => Math.hypot(o.x - x, o.y - y) > far)) return [x, y];
    }
  }
  throw new Error('no spot far from the objectives');
}

describe('Scry the Stars (NPC)', () => {
  it('is used from round 2 when a unit it can ward has an enemy within reach, not otherwise', () => {
    const near = arena({ [STARSEER]: [30, 20], [WARRIORS]: [30, 26], [DRYADS]: [30, 36] }, 'hero');
    const cands = scryCandidates(scenario, near, near.units[STARSEER]!);
    expect(npcScryWorthUsing(scenario, near, 0, cands)).toBe(true);
    near.round = 1;
    expect(npcScryWorthUsing(scenario, near, 0, cands)).toBe(false);
    const far = arena({ [STARSEER]: [10, 10], [WARRIORS]: [10, 14], [DRYADS]: [55, 40] }, 'hero');
    expect(
      npcScryWorthUsing(scenario, far, 0, scryCandidates(scenario, far, far.units[STARSEER]!)),
    ).toBe(false);
    // The decision itself: no Scry while nothing is threatened.
    expect(chooseAction(engine, far)).not.toMatchObject({ abilityId: SCRY_THE_STARS_ID });
    near.round = 2;
    expect(chooseAction(engine, near)).toMatchObject({ abilityId: SCRY_THE_STARS_ID });
  });

  it('wards the exposed units first, the most valuable first', () => {
    const s = arena(
      { [STARSEER]: [30, 20], [WARRIORS]: [30, 26], [ASTROLITH]: [30, 14], [DRYADS]: [30, 36] },
      'hero',
    );
    const picks = npcScryPicks(scenario, s, 0, [STARSEER, WARRIORS, ASTROLITH], 2);
    expect(picks).toHaveLength(2);
    // The Warriors stand 4" from the Dryads, the others are not within 14" of them.
    expect(picks[0]).toBe(WARRIORS);
  });
});

describe('Star-venom (NPC)', () => {
  it('goes for a target that can fight a friendly unit, and keeps the ability otherwise', () => {
    const s = arena({ [HUNTERS]: [30, 20], [DRYADS]: [30, 28] }, 'shooting');
    const hunters = s.units[HUNTERS]!;
    expect(npcStarVenomTarget(scenario, s, hunters, [DRYADS])).toBe(DRYADS);
    placeUnit(scenario, s, DRYADS, 30, 58);
    expect(npcStarVenomTarget(scenario, s, hunters, [DRYADS])).toBeNull();
  });
});

describe('Celestial Conduit (NPC)', () => {
  it('helps only when a unit it reaches is within reach of an objective the army does not hold', () => {
    const o = scenario.battlefield.objectives[0]!;
    const near = arena({ [ASTROLITH]: [o.x, o.y + 4], [WARRIORS]: [o.x, o.y] }, 'hero');
    expect(npcConduitHelps(scenario, near, near.units[ASTROLITH]!)).toBe(true);
    const [x, y] = remoteSpot(16);
    const away = arena({ [ASTROLITH]: [x, y], [WARRIORS]: [x, y + 5] }, 'hero');
    expect(npcConduitHelps(scenario, away, away.units[ASTROLITH]!)).toBe(false);
  });
});

describe('NPC: Coatl Familiar (R18)', () => {
  it('is used only when the extra D6 turns a likely failure into a likely success', () => {
    expect(npcCoatlHelps(6)).toBe(false); // 72% already
    expect(npcCoatlHelps(7)).toBe(false); // 58% already
    expect(npcCoatlHelps(8)).toBe(true); // 42% -> 84%
    expect(npcCoatlHelps(10)).toBe(true); // 17% -> 62%
    expect(npcCoatlHelps(11)).toBe(true); // 8% -> 50%
    expect(npcCoatlHelps(12)).toBe(false); // 3D6 >= 12 is 38%
  });
});
