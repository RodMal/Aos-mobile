import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario, modelFootprint } from '../../engine/index.js';
import { editable, keepOnly, placeUnit } from '../../engine/test-helpers.js';
import { INTO_THE_FIRE_RULES } from '../battleplans/index.js';
import {
  contestedObjective,
  controlScores,
  footprintToPoint,
  resolveControl,
} from './objectives.js';
import { rallyPoints, rallySpend } from './rally.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const fresh = createEngine(scenario).newGame(1);
const centre = scenario.battlefield.objectives.find((o) => o.id === 'scions-of-the-comet')!;
const west = scenario.battlefield.objectives.find((o) => o.id === 'golden-lions-1')!;

function setup(): ReturnType<typeof editable> {
  const s = editable(fresh);
  keepOnly(s, ['0:6', '1:7']);
  placeUnit(scenario, s, '0:6', 5, 40);
  placeUnit(scenario, s, '1:7', 55, 40);
  return s;
}

describe('contesting', () => {
  it('measures from the edge of the base to the objective centre', () => {
    expect(footprintToPoint({ kind: 'circle', cx: 3, cy: 4, r: 1 }, 0, 0)).toBeCloseTo(4);
  });

  it('a model within the radius contests; one just outside does not', () => {
    const s = setup();
    const dryad = s.units['0:6']!;
    const fp = modelFootprint(scenario, dryad, 0);
    const r = fp.kind === 'circle' ? fp.r : 0;
    Object.assign(dryad.models[0]!, { x: centre.x + centre.radius + r - 0.01, y: centre.y });
    expect(contestedObjective(scenario, dryad, 0)?.id).toBe(centre.id);
    Object.assign(dryad.models[0]!, { x: centre.x + centre.radius + r + 0.05, y: centre.y });
    expect(contestedObjective(scenario, dryad, 0)).toBeNull();
  });
});

describe('control', () => {
  it('sums the Control of contesting models; the higher score takes control', () => {
    const s = setup();
    placeUnit(scenario, s, '0:6', centre.x, centre.y);
    const scores = controlScores(scenario, s);
    expect(scores.get(centre.id)![0]).toBe(10);
    expect(resolveControl(scenario, s)).toEqual([{ id: centre.id, controller: 0 }]);
  });

  it('a tie keeps the current controller; nobody nearby keeps it too', () => {
    const s = setup();
    s.objectives.find((o) => o.id === centre.id)!.controller = 1;
    expect(resolveControl(scenario, s)).toEqual([]);
    // One Dryad (Control 1) against one Skink (Control 1) on the same objective.
    for (const id of ['0:6', '1:7']) s.units[id]!.models.forEach((m, i) => (m.alive = i === 0));
    Object.assign(s.units['0:6']!.models[0]!, { x: centre.x - 1.5, y: centre.y });
    Object.assign(s.units['1:7']!.models[0]!, { x: centre.x + 1.5, y: centre.y });
    expect(controlScores(scenario, s).get(centre.id)).toEqual([1, 1]);
    expect(resolveControl(scenario, s)).toEqual([]);
    // A second Dryad tips it.
    s.units['0:6']!.models[1]!.alive = true;
    Object.assign(s.units['0:6']!.models[1]!, { x: centre.x, y: centre.y - 1.5 });
    expect(resolveControl(scenario, s)).toEqual([{ id: centre.id, controller: 0 }]);
  });

  it('a model contests only the nearest objective', () => {
    const s = setup();
    placeUnit(scenario, s, '0:6', west.x, west.y);
    const scores = controlScores(scenario, s);
    expect(scores.get(west.id)![0]).toBe(10);
    expect(scores.get(centre.id)![0]).toBe(0);
  });
});

describe('Into the Fire scoring', () => {
  const score = (mine: number, theirs: number): number => {
    const s = editable(fresh);
    s.objectives.forEach((o, i) => {
      o.controller = i < mine ? 0 : i < mine + theirs ? 1 : null;
    });
    return INTO_THE_FIRE_RULES.endOfTurnScore(s, 0).reduce((n, l) => n + l.vp, 0);
  };

  it('3 for one objective, 3 more for two or more, 4 for more than the opponent', () => {
    expect(score(0, 0)).toBe(0);
    expect(score(1, 0)).toBe(7);
    expect(score(1, 1)).toBe(3);
    expect(score(2, 0)).toBe(10);
    expect(score(2, 3)).toBe(6);
    expect(score(0, 2)).toBe(0);
  });
});

describe('rally arithmetic', () => {
  it('counts each 4+ as a rally point', () => {
    expect(rallyPoints([1, 4, 6, 3, 5, 2])).toBe(3);
  });

  it('returns models first, then heals with what is left', () => {
    expect(rallySpend(5, 2, 3, 1)).toEqual({ returnModels: 2, heal: 1 });
    expect(rallySpend(3, 6, 1, 4)).toEqual({ returnModels: 0, heal: 3 });
    expect(rallySpend(4, 1, 0, 2)).toEqual({ returnModels: 0, heal: 2 });
  });
});
