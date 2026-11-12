/**
 * Unbinds by power level (owner, 2026-11-12): a Wizard (N) can attempt N unbinds per turn.
 * Casting, unbinding and banishing share the count within a turn, and it resets every turn,
 * so a Wizard (3) gets three unbind attempts in each enemy turn (docs/RULES-DECISIONS.md I58).
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario, type GameState, type UnitId } from '../index.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from '../test-helpers.js';
import { eligibleUnbinders } from './magic.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const ALARIELLE = '0:0'; // Wizard (3)
const DRYCHA = '0:3'; // Wizard (1)
const DRYADS = '0:6';
const KROAK = '1:0'; // Wizard (3)
const SAURUS_GUARD = '1:3';
const STARSEER = '1:6'; // Wizard (2)

/** Sylvaneth wizards on the left, the given Seraphon units within 30" of all of them. */
function arena(units: UnitId[], active: 0 | 1 = 0): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, units);
  const at: Record<string, [number, number]> = {
    [ALARIELLE]: [12, 22],
    [DRYCHA]: [12, 14],
    [DRYADS]: [18, 22],
    [KROAK]: [35, 22],
    [STARSEER]: [35, 14],
    [SAURUS_GUARD]: [35, 30],
  };
  for (const id of units) placeUnit(scenario, s, id, at[id]![0], at[id]![1]);
  s.active = active;
  s.turnIndex = 0;
  s.phase = 'hero';
  s.stack = [];
  for (const p of s.players) {
    p.cp = 4;
    p.rageDice = 0;
  }
  return s;
}

/**
 * `caster` casts `abilityId` successfully; returns the units offered Unbind and the state
 * after the reaction is answered (a failed unbind by `unbinder` when offered, else a pass).
 */
function castOnce(
  s: GameState,
  caster: UnitId,
  abilityId: string,
  target: UnitId | undefined,
  unbinder: UnitId,
): { offered: UnitId[]; state: GameState } {
  const cast = applyUntil(
    engine,
    s,
    { t: 'ability', unit: caster, abilityId, ...(target ? { target } : {}) },
    (r) => r.events.some((e) => e.t === 'cast' && e.success && e.total <= 10),
  );
  const d = engine.decision(cast.state);
  const offered =
    d?.kind === 'reaction'
      ? d.options.flatMap((o) => ('ability' in o && o.ability === 'unbind' ? [o.unit] : []))
      : [];
  if (!offered.includes(unbinder)) {
    const state =
      d?.kind === 'reaction' ? engine.apply(cast.state, { t: 'pass' }).state : cast.state;
    return { offered, state };
  }
  const r = applyUntil(
    engine,
    cast.state,
    { t: 'ability', unit: unbinder, abilityId: 'unbind' },
    (x) => x.events.some((e) => e.t === 'unbind' && !e.unbound),
  );
  return { offered, state: r.state };
}

/** The caster's first spell it may cast now, with its first legal target. */
function nextSpell(s: GameState, caster: UnitId): { abilityId: string; target?: UnitId } {
  const o = engine.unitOptions(s, caster).find((x) => x.t === 'ability' && x.kind === 'spell');
  if (!o || o.t !== 'ability') throw new Error(`${caster} has no spell to cast`);
  return { abilityId: o.abilityId, ...(o.targets[0] ? { target: o.targets[0] } : {}) };
}

describe('unbinds by power level', () => {
  for (const [unbinder, power, caster] of [
    [KROAK, 3, ALARIELLE],
    [STARSEER, 2, ALARIELLE],
    [ALARIELLE, 3, KROAK],
    [DRYCHA, 1, KROAK],
  ] as const) {
    it(`Wizard (${power}) ${unbinder} is offered Unbind while it has power level left`, () => {
      const s = arena([ALARIELLE, DRYCHA, KROAK, STARSEER]);
      for (let used = 0; used <= power; used++) {
        s.units[unbinder]!.castsUsed = used;
        const offered = eligibleUnbinders(scenario, s, s.units[caster]!).map((u) => u.id);
        expect(offered.includes(unbinder), `after ${used} used`).toBe(used < power);
      }
    });
  }

  it('Lord Kroak (Wizard 3) attempts three unbinds in one enemy turn, not a fourth', () => {
    let s = arena([ALARIELLE, DRYCHA, DRYADS, KROAK, SAURUS_GUARD]);
    placeUnit(scenario, s, SAURUS_GUARD, 24, 34); // a target for Alarielle's enemy spells
    const offeredKroak: boolean[] = [];
    for (const caster of [ALARIELLE, DRYCHA, ALARIELLE, ALARIELLE]) {
      const { abilityId, target } = nextSpell(s, caster);
      const r = castOnce(s, caster, abilityId, target, KROAK);
      offeredKroak.push(r.offered.includes(KROAK));
      s = r.state;
    }
    expect(offeredKroak).toEqual([true, true, true, false]);
    expect(s.units[KROAK]!.castsUsed).toBe(3);
  });

  it('a Skink Starseer (Wizard 2) attempts two unbinds in one enemy turn', () => {
    let s = arena([ALARIELLE, DRYCHA, DRYADS, STARSEER]);
    const offered: boolean[] = [];
    for (const caster of [ALARIELLE, DRYCHA, ALARIELLE]) {
      const { abilityId, target } = nextSpell(s, caster);
      const r = castOnce(s, caster, abilityId, target, STARSEER);
      offered.push(r.offered.includes(STARSEER));
      s = r.state;
    }
    expect(offered).toEqual([true, true, false]);
    expect(s.units[STARSEER]!.castsUsed).toBe(2);
  });

  it('Drycha (Wizard 1) attempts one unbind in one enemy turn; Alarielle (Wizard 3) three', () => {
    let s = arena([ALARIELLE, DRYCHA, DRYADS, KROAK, STARSEER, SAURUS_GUARD], 1);
    const offeredDrycha: boolean[] = [];
    const offeredAlarielle: boolean[] = [];
    // Drycha takes the first unbind, Alarielle the next three; then neither has any left.
    for (const caster of [STARSEER, KROAK, KROAK, KROAK]) {
      const { abilityId, target } = nextSpell(s, caster);
      const unbinder = offeredDrycha.length === 0 ? DRYCHA : ALARIELLE;
      const r = castOnce(s, caster, abilityId, target, unbinder);
      offeredDrycha.push(r.offered.includes(DRYCHA));
      offeredAlarielle.push(r.offered.includes(ALARIELLE));
      s = r.state;
    }
    expect(offeredDrycha).toEqual([true, false, false, false]);
    expect(offeredAlarielle).toEqual([true, true, true, true]);
    expect(s.units[ALARIELLE]!.castsUsed).toBe(3);
    expect(s.units[DRYCHA]!.castsUsed).toBe(1);
    expect(eligibleUnbinders(scenario, s, s.units[KROAK]!)).toEqual([]);
  });

  it('a miscast in its own turn does not stop Kroak unbinding in the next (enemy) turn', () => {
    let s = arena([ALARIELLE, DRYADS, KROAK, SAURUS_GUARD], 1);
    const spell = nextSpell(s, KROAK);
    const miscast = applyUntil(engine, s, { t: 'ability', unit: KROAK, ...spell }, (r) =>
      r.events.some((e) => e.t === 'cast' && e.miscast),
    );
    s = miscast.state;
    expect(s.units[KROAK]!.miscast).toBe(true);
    expect(s.units[KROAK]!.castsUsed).toBe(1);
    // No more spells this phase.
    expect(
      engine
        .unitOptions(s, KROAK)
        .some((o) => o.t === 'ability' && (o.kind === 'spell' || o.kind === 'summon')),
    ).toBe(false);
    // Play on to the Sylvaneth hero phase.
    for (let i = 0; i < 200; i++) {
      const d = engine.decision(s);
      if (s.active === 0 && s.phase === 'hero' && d?.kind === 'main') break;
      s = engine.apply(s, d?.kind === 'main' ? { t: 'pass' } : engine.defaultAction(s)).state;
    }
    expect(s.active).toBe(0);
    s.units[KROAK]!.damage = 0;
    const { abilityId, target } = nextSpell(s, ALARIELLE);
    const r = castOnce(s, ALARIELLE, abilityId, target, KROAK);
    expect(r.offered).toContain(KROAK);
  });

  // Owner, 2026-11-12: a Wizard can unbind in its own turn when the enemy casts through
  // Magical Intervention, with what is left of its count for that turn.
  for (const ownCasts of [2, 3]) {
    it(`Alarielle unbinds Kroak's Magical Intervention spell in her own turn after ${ownCasts} casts: ${ownCasts < 3 ? 'offered' : 'none left'}`, () => {
      let s = arena([ALARIELLE, DRYADS, KROAK, SAURUS_GUARD]);
      placeUnit(scenario, s, SAURUS_GUARD, 24, 34); // a target for Alarielle's enemy spells
      for (let k = 0; k < ownCasts; k++) {
        const { abilityId, target } = nextSpell(s, ALARIELLE);
        s = castOnce(s, ALARIELLE, abilityId, target, 'nobody').state;
      }
      expect(s.units[ALARIELLE]!.castsUsed).toBe(ownCasts);
      // End the hero phase: Kroak is offered Magical Intervention and takes it.
      s = engine.apply(s, { t: 'pass' }).state;
      const d = engine.decision(s);
      expect(d?.kind).toBe('reaction');
      s = engine.apply(s, { t: 'command', command: 'magicalIntervention', unit: KROAK }).state;
      const { abilityId, target } = nextSpell(s, KROAK);
      const cast = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId, ...(target ? { target } : {}) },
        (r) => r.events.some((e) => e.t === 'cast' && e.success && e.total <= 9),
      );
      const reaction = engine.decision(cast.state);
      const offered =
        reaction?.kind === 'reaction' && reaction.player === 0
          ? reaction.options.filter((o) => o.ability === 'unbind').map((o) => o.unit)
          : [];
      expect(offered).toEqual(ownCasts < 3 ? [ALARIELLE] : []);
      if (ownCasts < 3) {
        const r = engine.apply(cast.state, { t: 'ability', unit: ALARIELLE, abilityId: 'unbind' });
        expect(r.events.some((e) => e.t === 'unbind' && e.unit === ALARIELLE)).toBe(true);
        expect(r.state.units[ALARIELLE]!.castsUsed).toBe(ownCasts + 1);
      }
    });
  }
});
