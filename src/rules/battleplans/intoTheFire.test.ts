import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { cloneState } from '../../engine/engine.js';
import { createEngine, createScenario, unitsOf } from '../../engine/index.js';
import { attackModifiers } from '../core/modifiers.js';
import { controlScores } from '../core/objectives.js';
import { battleplanRules } from './index.js';
import { profileOf } from '../../engine/query.js';
import { startGame } from '../../engine/test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

describe('Into the Fire battleplan (GHB 2026-27 1-1)', () => {
  it('scores 3VP for 1 objective, 3VP for 2+ objectives, and 4VP for more than opponent', () => {
    const state = cloneState(startGame(engine, 1));
    const bp = battleplanRules('into-the-fire');

    // 0 objectives
    expect(bp.endOfTurnScore(state, 0)).toEqual([]);

    // 1 objective
    state.objectives[0]!.controller = 0;
    expect(bp.endOfTurnScore(state, 0)).toEqual([
      { vp: 3, reason: 'Controlled at least 1 objective (1 held)' },
      { vp: 4, reason: 'Controlled more objectives than the opponent (1 to 0)' },
    ]);

    // 2 objectives, opponent has 1
    state.objectives[1]!.controller = 0;
    state.objectives[2]!.controller = 1;
    expect(bp.endOfTurnScore(state, 0)).toEqual([
      { vp: 3, reason: 'Controlled at least 1 objective (2 held)' },
      { vp: 3, reason: 'Controlled 2 or more objectives (2 held)' },
      { vp: 4, reason: 'Controlled more objectives than the opponent (2 to 1)' },
    ]);

    // Tied 2 objectives each
    state.objectives[3]!.controller = 1;
    expect(bp.endOfTurnScore(state, 0)).toEqual([
      { vp: 3, reason: 'Controlled at least 1 objective (2 held)' },
      { vp: 3, reason: 'Controlled 2 or more objectives (2 held)' },
    ]);
  });

  it('Secure the Gateway grants Anti-charge (+1 Rend) when controlling own Place of Power and contesting a controlled objective', () => {
    const state = cloneState(startGame(engine, 1));
    const bp = battleplanRules('into-the-fire');

    const durthu = unitsOf(state, 0).find((u) => u.name === 'Spirit of Durthu')!;
    const warriors = unitsOf(state, 1).find((u) => u.name === 'Saurus Warriors')!;
    const weapon = profileOf(scenario, durthu).weapons.find((w) => w.kind === 'melee')!;

    // Target charged this turn
    warriors.charged = true;

    // Place of power spire-w is at (7, 28). Control it with a Dryad model
    const dryads = unitsOf(state, 0).find((u) => u.name === 'Dryads')!;
    dryads.models[0]!.x = 7;
    dryads.models[0]!.y = 28;

    // Objective sun-seekers at (30, 5.5) controlled by player 0
    state.objectives[0]!.controller = 0;
    durthu.models[0]!.x = scenario.battlefield.objectives[0]!.x;
    durthu.models[0]!.y = scenario.battlefield.objectives[0]!.y;

    const situation = {
      attacker: durthu,
      target: warriors,
      weapon,
      mode: 'fight' as const,
    };

    const mods = bp.attackModifiers?.(scenario, state, situation);
    expect(mods).toBeDefined();
    expect(
      mods?.some(
        (m) => m.source.includes('Secure the Gateway') && m.stat === 'rend' && m.value === 1,
      ),
    ).toBe(true);

    const allMods = attackModifiers(scenario, state, situation);
    expect(allMods.some((m) => m.source.includes('Secure the Gateway') && m.stat === 'rend')).toBe(
      true,
    );
  });

  it('Determined Defenders adds 3 to control score when the player is the underdog and unit is wholly outside enemy territory', () => {
    const state = cloneState(startGame(engine, 1));

    // Player 0 is underdog: player 1 has 5 VP, player 0 has 0 VP
    state.players[0].vp = 0;
    state.players[1].vp = 5;

    // Move all units far away
    for (const id of state.unitOrder) {
      const u = state.units[id]!;
      for (const m of u.models) {
        m.x = 55;
        m.y = 40;
      }
    }

    // Place 1 model of Spite-Revenants (control 1) on objective 0 (30, 5.5)
    // Objective 0 at (30, 5.5) is outside Territory A (enemy territory for player 0)
    const spites = unitsOf(state, 0).find((u) => u.name === 'Spite-Revenants')!;
    spites.models.forEach((m, idx) => {
      m.alive = idx === 0;
      m.x = 30;
      m.y = 5.5;
    });

    const scores = controlScores(scenario, state);
    const obj0Score = scores.get(scenario.battlefield.objectives[0]!.id);
    // Base control is 1, Determined Defenders adds 3 -> 4
    expect(obj0Score?.[0]).toBe(4);
  });
});
