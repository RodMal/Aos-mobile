import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { chooseAction } from '../ai/baseline.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  overgrownTokenIds,
  type GameState,
} from './index.js';
import { editable, passTo, startGame } from './test-helpers.js';
import { WYLDWOOD_SETUP_ID } from './wyldwood.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const setUp = { t: 'ability', unit: WYLDWOOD, abilityId: WYLDWOOD_SETUP_ID } as const;

const hasOption = (s: GameState) =>
  engine
    .unitOptions(s, WYLDWOOD)
    .some((o) => o.t === 'ability' && o.abilityId === WYLDWOOD_SETUP_ID);

const wyldwoods = (s: GameState) =>
  Object.values(s.units).filter(
    (u) => u.owner === 0 && u.status === 'battlefield' && u.name === 'Awakened Wyldwood',
  );

/** Sets up one more piece at the suggested spot. */
function setUpOne(s: GameState): GameState {
  const declared = engine.apply(s, setUp).state;
  const d = engine.decision(declared)!;
  if (d.kind !== 'place' || d.reason !== 'setUp') throw new Error('expected a set-up placement');
  const piece = declared.units[d.unit]!;
  const placement = {
    unit: piece.id,
    models: piece.models.map((m, i) => ({ i, x: m.x, y: m.y, rot: m.rot })),
  };
  return engine.apply(declared, { t: 'place', placement }).state;
}

describe('further Awakened Wyldwood pieces (owner, 2026-11-11)', () => {
  it('is offered in the Sylvaneth player’s own hero phase, once per turn', () => {
    const s = startGame(engine, 1);
    expect(s.active).toBe(0);
    expect(wyldwoods(s)).toHaveLength(1);
    expect(hasOption(s)).toBe(true);
    const after = setUpOne(s);
    expect(wyldwoods(after)).toHaveLength(2);
    // The new piece is its own faction terrain with the second outline.
    const piece = wyldwoods(after).find((u) => u.id !== WYLDWOOD)!;
    expect(piece.profileId).toMatch(/:piece2$/);
    expect(hasOption(after)).toBe(false);
    expect(() => engine.apply(after, setUp)).toThrow(IllegalActionError);
    // Not in other phases.
    expect(hasOption(passTo(engine, editable(s), 'movement'))).toBe(false);
  });

  it('stops at three pieces on the battlefield', () => {
    let s = setUpOne(startGame(engine, 1));
    s = editable(s);
    delete s.players[0].wyldwoodSetUpTurn; // as if a later turn
    s = setUpOne(s);
    expect(wyldwoods(s)).toHaveLength(3);
    expect(wyldwoods(s).map((u) => u.profileId.replace(/.*:/, ''))).toContain('piece3');
    s = editable(s);
    delete s.players[0].wyldwoodSetUpTurn;
    expect(hasOption(s)).toBe(false);
  });

  it('rejects a spot within 3" of an objective, a terrain feature or a unit, or off the table', () => {
    const declared = engine.apply(startGame(engine, 1), setUp).state;
    const d = engine.decision(declared)!;
    if (d.kind !== 'place') throw new Error('expected placement');
    const at = (x: number, y: number) =>
      engine
        .checkPlacement(declared, { unit: d.unit, models: [{ i: 0, x, y, rot: 0 }] })
        .map((v) => v.message);
    const obj = scenario.battlefield.objectives[0]!;
    expect(at(obj.x, obj.y).join(' ')).toMatch(/objective/);
    const feature = scenario.battlefield.terrain[0]!;
    expect(at(feature.centre[0], feature.centre[1]).join(' ')).toMatch(/terrain feature/);
    const unit = declared.units['0:6']!.models[0]!;
    expect(at(unit.x, unit.y).join(' ')).toMatch(/unit/);
    expect(at(-5, 10).join(' ')).toMatch(/wholly on the battlefield/);
  });

  it('pass cancels the set-up and the option comes back', () => {
    const s = startGame(engine, 1);
    const declared = engine.apply(s, setUp).state;
    const d = engine.decision(declared)!;
    if (d.kind !== 'place') throw new Error('expected placement');
    const back = engine.apply(declared, { t: 'pass' }).state;
    expect(back.units[d.unit]).toBeUndefined();
    expect(wyldwoods(back)).toHaveLength(1);
    expect(hasOption(back)).toBe(true);
  });

  it('carries its owner’s overgrown token and survives a JSON round trip', () => {
    const s = startGame(engine, 1);
    const before = overgrownTokenIds(scenario, s, 0).length;
    const after = setUpOne(s);
    expect(overgrownTokenIds(scenario, after, 0).length).toBe(before + 1);
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  });

  it('the NPC sets one up and places it legally', () => {
    let s = startGame(engine, 1);
    const a = chooseAction(engine, s);
    expect(a).toEqual(setUp);
    s = engine.apply(s, a).state;
    s = engine.apply(s, chooseAction(engine, s)).state;
    expect(wyldwoods(s)).toHaveLength(2);
    expect(engine.decision(s)).toMatchObject({ kind: 'main', phase: 'hero' });
  });
});
