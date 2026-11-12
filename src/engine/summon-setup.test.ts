/**
 * Setting up a summoned manifestation is measured from the caster, not from the suggested
 * spot (owner's play-test, 2026-11-12: "Set up manifestation Chronomantic Cogs" measured
 * 7.6"/12" from where the manifestation was first shown).
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { setUpReach } from '../ui/game/placementEdit.js';
import { createEngine, createScenario, unitCentre, type GameState } from './index.js';
import { modelFootprint } from './query.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from './test-helpers.js';
import type { Placement } from './types.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const ALARIELLE = '0:0';
const SUMMON_COGS = 'c402-d205-c59f-e84b';

/** Alarielle has cast Chronomantic Cogs; the set-up `place` decision is pending. */
function summoning(): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, [ALARIELLE, '1:3']);
  placeUnit(scenario, s, ALARIELLE, 20, 22);
  placeUnit(scenario, s, '1:3', 56, 40); // far away: no unbind, no 9" problem
  s.active = 0;
  s.phase = 'hero';
  s.stack = [];
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  const r = applyUntil(
    engine,
    s,
    { t: 'ability', unit: ALARIELLE, abilityId: SUMMON_COGS },
    (x) => engine.decision(x.state)?.kind === 'place',
  );
  return r.state;
}

describe('setting up a summoned manifestation', () => {
  it('is measured from the caster: 11" from Alarielle is legal however far from the suggested spot; 13" is not', () => {
    const s = summoning();
    const d = engine.decision(s);
    if (d?.kind !== 'place') throw new Error('no set-up decision');
    expect(d.reason).toBe('summon');
    const cogs = s.units[d.unit]!;
    const suggested = unitCentre(cogs);
    const c = s.units[ALARIELLE]!.models[0]!;
    const rA = 160 / 25.4 / 2;
    const fp0 = modelFootprint(scenario, cogs, 0, { x: 0, y: 0, rot: 0 });
    const rc = fp0.kind === 'circle' ? fp0.r : Math.max(Math.abs(fp0.cx), 1);
    const at = (deg: number, wholly: number): Placement => {
      const a = (deg * Math.PI) / 180;
      const centre = rA + wholly - rc - 0.05;
      return {
        unit: cogs.id,
        models: cogs.models.map((m, i) => ({
          i,
          x: c.x + Math.cos(a) * centre + (m.x - cogs.models[0]!.x),
          y: c.y + Math.sin(a) * centre + (m.y - cogs.models[0]!.y),
          rot: m.rot,
        })),
      };
    };
    let found = false;
    for (let deg = 0; deg < 360 && !found; deg += 15) {
      const p = at(deg, 11);
      const away = Math.hypot(p.models[0]!.x - suggested.x, p.models[0]!.y - suggested.y);
      if (away < 14) continue;
      if (engine.checkPlacement(s, p).length > 0) continue;
      found = true;
      expect(engine.apply(s, { t: 'place', placement: p }).state.units[cogs.id]!.models[0]!.x).toBe(
        p.models[0]!.x,
      );
      // The UI measures from the caster too.
      const reach = setUpReach(scenario, s, p)!;
      expect(reach.caster.id).toBe(ALARIELLE);
      expect(reach.range).toBe(12);
      expect(reach.dist).toBeGreaterThan(10);
      expect(reach.dist).toBeLessThanOrEqual(12);
      // Two inches further out is too far, with a readable reason.
      const far = engine.checkPlacement(s, at(deg, 13));
      expect(far.find((v) => v.code === 'TOO_FAR')?.message).toBe(
        'Must be set up wholly within 12" of Alarielle the Everqueen.',
      );
      expect(setUpReach(scenario, s, at(deg, 13))!.dist).toBeGreaterThan(12);
    }
    expect(found).toBe(true);
  });
});
