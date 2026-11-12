/**
 * Attacking faction terrain must never leave a decision nobody can answer (owner's bug,
 * 2026-11-12: Alarielle attacking the Realmshaper Engine in round 5 left "Seraphon may react"
 * waiting forever).
 */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, profileOf, type GameState, type UnitId } from './index.js';
import { footprintGap } from '../geom/index.js';
import { modelFootprint } from './query.js';
import { editable, keepOnly, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

function terrainOf(s: GameState, owner: 0 | 1): UnitId {
  return s.unitOrder.find(
    (id) => s.units[id]!.owner === owner && profileOf(scenario, s.units[id]!).isFactionTerrain,
  )!;
}

/** Puts `attacker` in base contact with `terrain`, at the start of `attacker`'s combat phase. */
function arena(attacker: UnitId, owner: 0 | 1, extra: UnitId[] = []): GameState {
  const s = editable(startGame(engine, 1));
  const terrain = terrainOf(s, owner === 0 ? 1 : 0);
  keepOnly(s, [attacker, terrain, ...extra]);
  const t = s.units[terrain]!.models[0]!;
  const tfp = modelFootprint(scenario, s.units[terrain]!, 0);
  // Come in from the board's centre side until the attacker's first model is in base contact.
  const dir = t.x > scenario.battlefield.width / 2 ? -1 : 1;
  for (let d = 12; d > 0; d -= 0.05) {
    placeUnit(scenario, s, attacker, t.x + dir * d, t.y);
    const gap = footprintGap(modelFootprint(scenario, s.units[attacker]!, 0), tfp);
    if (gap <= 0.3) break;
  }
  s.round = 5;
  s.active = owner;
  s.turnIndex = 0;
  s.phase = 'combat';
  s.fightPicker = owner;
  s.stack = [];
  for (const p of s.players) p.cp = 4;
  return s;
}

/** Plays with the NPC on both sides until the turn ends; every action must be legal. */
function playOutTurn(s0: GameState): GameState {
  let s = s0;
  const turn = `${s.round}:${s.turnIndex}`;
  for (let i = 0; i < 300 && `${s.round}:${s.turnIndex}` === turn; i++) {
    const d = engine.decision(s);
    if (!d) break;
    const action = chooseAction(engine, s);
    s = engine.apply(s, action).state;
    // The default action is always legal too.
    const d2 = engine.decision(s);
    if (d2) expect(() => engine.apply(s, engine.defaultAction(s))).not.toThrow();
  }
  return s;
}

describe('attacking faction terrain', () => {
  it('Alarielle attacking the Realmshaper Engine: the NPC answers every decision', () => {
    for (const rage of [0, 3]) {
      const s = arena('0:0', 0);
      s.players[0].rageDice = rage;
      s.players[1].rageDice = rage;
      const end = playOutTurn(s);
      expect(`${end.round}:${end.turnIndex}`).not.toBe('5:0');
    }
  });

  it('Lord Kroak attacking the Awakened Wyldwood: the NPC answers every decision', () => {
    for (const rage of [0, 3]) {
      const s = arena('1:0', 1);
      s.players[0].rageDice = rage;
      s.players[1].rageDice = rage;
      const end = playOutTurn(s);
      expect(`${end.round}:${end.turnIndex}`).not.toBe('5:0');
    }
  });

  // The owner's game: before 19daffc the damaged Realmshaper Engine was offered Fight Through
  // the Pain, the NPC answered it, the engine refused ("faction terrain ... cannot fight") and
  // the UI waited for an answer forever.
  for (const [attacker, owner] of [
    ['0:0', 0],
    ['1:0', 1],
  ] as const) {
    it(`${attacker} attacking damaged faction terrain (as a player would) raises no reaction for it`, () => {
      for (const allOutAttack of [false, true]) {
        let s = arena(attacker, owner);
        s.players[0].rageDice = 3;
        s.players[1].rageDice = 3;
        const terrain = terrainOf(s, owner === 0 ? 1 : 0);
        s.units[terrain]!.damage = profileOf(scenario, s.units[terrain]!).health - 2;
        let attacked = false;
        for (let i = 0; i < 60 && s.turnIndex === 0; i++) {
          const d = engine.decision(s);
          if (!d) break;
          if (d.kind === 'reaction') {
            expect(d.options.map((o) => o.unit)).not.toContain(terrain);
          }
          let action;
          if (d.player === owner && (d.kind === 'fightPick' || d.kind === 'main')) {
            const fight = engine.unitOptions(s, attacker).some((o) => o.t === 'fight');
            action = fight ? { t: 'fight' as const, unit: attacker } : { t: 'pass' as const };
          } else if (d.player === owner && d.kind === 'targets') {
            attacked = true;
            const allocations = engine
              .targetOptions(s, d.unit, 'fight')
              .filter((w) => w.targets.some((t) => t.unit === terrain))
              .map((w) => ({ weaponId: w.weaponId, target: terrain }));
            action = { t: 'targets' as const, allOutAttack, allocations };
          } else {
            action = d.player === owner ? engine.defaultAction(s) : chooseAction(engine, s);
          }
          s = engine.apply(s, action).state;
        }
        expect(attacked).toBe(true);
        expect(s.turnIndex).toBe(1);
      }
    });
  }
});
