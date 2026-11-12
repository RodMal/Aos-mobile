import { describe, expect, it } from 'vitest';
import { chargePlacement } from '../../ai/placement.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { attackModifiers, sumModifiers } from '../../rules/core/modifiers.js';
import { weaponMods } from '../combat.js';
import {
  createEngine,
  createScenario,
  currentFightTier,
  currentPlacement,
  eligibleFighters,
  inCombat,
  inCreepingOvergrowth,
  manifestationUnitId,
  profileOf,
  shiftPlacement,
  strikeOrder,
  unitGrants,
  type GameState,
  type UnitId,
} from '../index.js';
import {
  applyUntil,
  editable,
  keepOnly,
  passTo,
  placeUnit,
  weapon,
  startGame,
} from '../test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

// Sylvaneth (Player 0)
const ALARIELLE = '0:0'; // Wizard (3)
const DURTHU = '0:2'; // Monster, Health 14
const DRYCHA = '0:3'; // Wizard (1)
const WARSONG = '0:5'; // Wizard (1), Priest (1)
const DRYADS = '0:6'; // Health 1, 10 models
const DRYADS_2 = '0:7';

// Seraphon (Player 1)
const KROAK = '1:0'; // Wizard (3)
const KROXIGOR = '1:1';
const SAURUS_GUARD = '1:3'; // 10 models
const STARSEER = '1:6'; // Wizard (2)
const HUNTERS = '1:8'; // Ranged + melee, Health 1, 5 models

// Ability IDs
const JADE_THORNS = '97df-e136-9fb4-5aca';
const ZEPHYRSPITE_RUSH = '4ea1-b08a-3684-8d35';
const GRASPING_ROOTS = '77cf-59bd-fc8e-f6c7';
const SONG_OF_THE_LOST = 'a865-102f-ce95-480c';
const SONG_OF_DREAD = '4c37-4bd5-f9d5-170a';
const SONG_OF_WAR = '1b5b-a2e8-6dd3-17fb';
const COMETS_CALL = '78d-5a7e-a6c9-7674';
const MYSTICAL_UNFORGING = 'e0c2-6f59-3b19-9e51';
const SPEED_OF_HUANCHI = '6086-ce9b-38be-28b2';
const SUMMON_PENDULUM = '678b-96e1-66bb-1de8';
const SUMMON_COGS = 'c402-d205-c59f-e84b';
const SUMMON_SWORDS = 'd4da-e543-192d-84ae';
const SUMMON_PURPLE_SUN = '1b29-60f4-48d2-a6bb';
const SUMMON_MAELSTROM = '1f2c-ca29-2c5b-24ba';
const SUMMON_SHACKLES = 'ee70-f212-c079-a752';
const SUMMON_GRAVETIDE = '36e0-4b94-aeb-67ac';

// Manifestation Warscroll IDs
const WS_PENDULUM = 'fcb6-ae80-2e58-aadb';
const WS_COGS = '1aba-bc38-e988-d79f';
const WS_SWORDS = '8cde-fafe-2b2a-ced5';
const WS_PURPLE_SUN = 'e7a5-e611-4c13-22d0';
const WS_MAELSTROM = 'e699-49b7-d2b8-d5fc';
const WS_SHACKLES = 'dee3-92a0-27e7-252a';
const WS_GRAVETIDE = '1885-a1aa-bf5d-6d0d';

function baseArena(
  units: UnitId[] = [ALARIELLE, DRYCHA, WARSONG, DRYADS, KROAK, SAURUS_GUARD],
): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, units);
  // Put enemy wizards far away (> 30") by default so Unbind reactions don't trigger unless wanted
  if (units.includes(ALARIELLE)) placeUnit(scenario, s, ALARIELLE, 12, 22);
  if (units.includes(DRYCHA)) placeUnit(scenario, s, DRYCHA, 12, 14);
  if (units.includes(WARSONG)) placeUnit(scenario, s, WARSONG, 12, 30);
  if (units.includes(DRYADS)) placeUnit(scenario, s, DRYADS, 18, 22);
  if (units.includes(KROAK)) placeUnit(scenario, s, KROAK, 55, 22);
  if (units.includes(SAURUS_GUARD)) placeUnit(scenario, s, SAURUS_GUARD, 26, 22);
  s.players[0].cp = 4;
  s.players[1].cp = 4;
  // No Fight Through the Pain prompts (src/engine/fury-pain.test.ts covers them).
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return s;
}

describe('Magic & Prayers Core Mechanics', () => {
  it('enforces casting roll >= CV, Wizard power level limit, and Rule of One vs UNLIMITED', () => {
    const s = baseArena([ALARIELLE, DRYCHA, WARSONG, DRYADS, SAURUS_GUARD]);
    expect(profileOf(scenario, s.units[DRYCHA]!).wizard).toBe(1);
    expect(profileOf(scenario, s.units[ALARIELLE]!).wizard).toBe(3);

    // 1. Failed cast (< CV 6) on Alarielle consumes 1 of her 3 power level and marks ability used by her
    const failed = applyUntil(
      engine,
      s,
      { t: 'ability', unit: ALARIELLE, abilityId: JADE_THORNS, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && !e.success && !e.miscast),
    );
    expect(failed.state.units[ALARIELLE]!.castsUsed).toBe(1);
    // Same wizard (Alarielle) cannot attempt UNLIMITED Jade Thorns a second time in the same turn, even with power level remaining
    expect(
      engine
        .unitOptions(failed.state, ALARIELLE)
        .some((o) => o.t === 'ability' && o.abilityId === JADE_THORNS),
    ).toBe(false);

    // 2. Second wizard (Drycha) CAN attempt UNLIMITED spell (Jade Thorns) in the same turn
    expect(
      engine
        .unitOptions(failed.state, DRYCHA)
        .some((o) => o.t === 'ability' && o.abilityId === JADE_THORNS),
    ).toBe(true);
    const castJade = applyUntil(
      engine,
      failed.state,
      { t: 'ability', unit: DRYCHA, abilityId: JADE_THORNS, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    expect(castJade.state.units[DRYCHA]!.castsUsed).toBe(1);
    // Drycha has reached power level 1 -> no more magic options
    expect(
      engine.unitOptions(castJade.state, DRYCHA).filter((o) => o.t === 'ability'),
    ).toHaveLength(0);

    // 3. Non-UNLIMITED spell (Grasping Roots) attempted by Alarielle cannot be attempted by Warsong
    const castRoots = applyUntil(
      engine,
      castJade.state,
      { t: 'ability', unit: ALARIELLE, abilityId: GRASPING_ROOTS, target: SAURUS_GUARD },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    expect(castRoots.state.players[0].spellsAttempted).toContain(GRASPING_ROOTS);
    expect(
      engine
        .unitOptions(castRoots.state, WARSONG)
        .some((o) => o.t === 'ability' && o.abilityId === GRASPING_ROOTS),
    ).toBe(false);

    // 4. Verify Seraphon UNLIMITED (Mystical Unforging) vs non-UNLIMITED (Comet's Call)
    const s3 = baseArena([DRYADS, KROAK, STARSEER]);
    s3.active = 1;
    placeUnit(scenario, s3, KROAK, 30, 22);
    placeUnit(scenario, s3, STARSEER, 30, 28);
    placeUnit(scenario, s3, DRYADS, 22, 25);

    const afterComet = applyUntil(
      engine,
      s3,
      { t: 'ability', unit: KROAK, abilityId: COMETS_CALL, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    ).state;
    // Starseer cannot attempt Comet's Call
    expect(
      engine
        .unitOptions(afterComet, STARSEER)
        .some((o) => o.t === 'ability' && o.abilityId === COMETS_CALL),
    ).toBe(false);

    const afterUnforging = applyUntil(
      engine,
      afterComet,
      { t: 'ability', unit: KROAK, abilityId: MYSTICAL_UNFORGING, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    ).state;
    // Kroak cannot attempt Mystical Unforging again, but Starseer CAN
    expect(
      engine
        .unitOptions(afterUnforging, KROAK)
        .some((o) => o.t === 'ability' && o.abilityId === MYSTICAL_UNFORGING),
    ).toBe(false);
    expect(
      engine
        .unitOptions(afterUnforging, STARSEER)
        .some((o) => o.t === 'ability' && o.abilityId === MYSTICAL_UNFORGING),
    ).toBe(true);
  });

  it('resolves Miscast on unmodified double 1: spell fails, D3 mortal damage, no more casts this phase', () => {
    const s = baseArena([ALARIELLE, DRYADS]);
    const r = applyUntil(
      engine,
      s,
      { t: 'ability', unit: ALARIELLE, abilityId: JADE_THORNS, target: DRYADS },
      (res) => res.events.some((e) => e.t === 'cast' && e.miscast),
    );
    const castEv = r.events.find((e) => e.t === 'cast');
    expect(castEv).toMatchObject({
      t: 'cast',
      unit: ALARIELLE,
      dice: [1, 1],
      success: false,
      miscast: true,
    });
    expect(
      r.events.some((e) => e.t === 'damage' && e.unit === ALARIELLE && e.source === 'Miscast'),
    ).toBe(true);
    // Alarielle is Wizard (3), miscast sets castsUsed to full power level (3)
    expect(r.state.units[ALARIELLE]!.castsUsed).toBe(3);
    expect(
      engine
        .unitOptions(r.state, ALARIELLE)
        .filter((o) => o.t === 'ability' && o.abilityId !== 'place-of-power'),
    ).toHaveLength(0);
    expect(r.state.effects?.some((e) => e.id === JADE_THORNS)).toBeFalsy();
  });

  it('offers Unbind reaction when enemy Wizard is within 30", and unbinding prevents the spell', () => {
    const s = baseArena([ALARIELLE, DRYADS, KROAK]);
    // Place Kroak within 30" of Alarielle (12, 22) -> (35, 22) is ~23"
    placeUnit(scenario, s, KROAK, 35, 22);

    const castRes = applyUntil(
      engine,
      s,
      { t: 'ability', unit: ALARIELLE, abilityId: JADE_THORNS, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && e.success && e.total === 6),
    );
    expect(engine.decision(castRes.state)).toEqual({
      kind: 'reaction',
      player: 1,
      options: [{ ability: 'unbind', unit: KROAK, cost: 0 }],
      trigger: `spell:${ALARIELLE}:Jade Thorns`,
    });

    // Answer with unbind that beats castTotal (6)
    const unboundRes = applyUntil(
      engine,
      castRes.state,
      { t: 'ability', unit: KROAK, abilityId: 'unbind' },
      (r) => r.events.some((e) => e.t === 'unbind' && e.unbound),
    );
    const unbindEv = unboundRes.events.find((e) => e.t === 'unbind');
    expect(unbindEv).toMatchObject({
      t: 'unbind',
      unit: KROAK,
      caster: ALARIELLE,
      castTotal: 6,
      unbound: true,
    });
    expect(unboundRes.state.units[KROAK]!.castsUsed).toBe(1);
    expect(unboundRes.state.effects?.some((e) => e.id === JADE_THORNS)).toBeFalsy();

    // If unbind fails (<= castTotal), the spell resolves
    const failedUnbind = applyUntil(
      engine,
      castRes.state,
      { t: 'ability', unit: KROAK, abilityId: 'unbind' },
      (r) => r.events.some((e) => e.t === 'unbind' && !e.unbound),
    );
    expect(failedUnbind.state.effects?.some((e) => e.id === JADE_THORNS)).toBe(true);
  });

  it('handles Chanting & ritual points: roll of 1 loses D3 points, banking accumulates, answering resets to 0', () => {
    const s = baseArena([WARSONG, DRYADS]);
    s.units[WARSONG]!.ritualPoints = 2;

    // 1. Unmodified roll of 1 loses D3 ritual points
    const rolledOne = applyUntil(
      engine,
      s,
      { t: 'ability', unit: WARSONG, abilityId: SONG_OF_THE_LOST, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'chant' && e.die === 1),
    );
    expect(rolledOne.state.units[WARSONG]!.ritualPoints).toBeLessThan(2);
    expect(rolledOne.events.find((e) => e.t === 'chant')).toMatchObject({
      die: 1,
      answered: false,
    });

    // 2. Roll of 2+ below chantingValue (or with choice: 'bank') banks ritual points
    const sBank = baseArena([WARSONG, DRYADS]);
    sBank.units[WARSONG]!.ritualPoints = 0;
    // Song of War has chantingValue 5; rolling a 3 banks 3 points automatically
    const bankedAuto = applyUntil(
      engine,
      sBank,
      { t: 'ability', unit: WARSONG, abilityId: SONG_OF_WAR, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'chant' && e.die === 3),
    );
    expect(bankedAuto.state.units[WARSONG]!.ritualPoints).toBe(3);
    expect(bankedAuto.state.effects?.some((e) => e.id === SONG_OF_WAR)).toBeFalsy();

    // Explicit choice: 'bank' even when die >= chantingValue
    const bankedExplicit = applyUntil(
      engine,
      sBank,
      { t: 'ability', unit: WARSONG, abilityId: SONG_OF_THE_LOST, target: DRYADS, choice: 'bank' },
      (r) => r.events.some((e) => e.t === 'chant' && e.die === 5),
    );
    expect(bankedExplicit.state.units[WARSONG]!.ritualPoints).toBe(5);
    expect(bankedExplicit.state.effects?.some((e) => e.id === SONG_OF_THE_LOST)).toBeFalsy();

    // 3. When ritualPoints + die >= chantingValue, answers the prayer and resets ritualPoints = 0
    const sAnswer = baseArena([WARSONG, DRYADS]);
    sAnswer.units[WARSONG]!.ritualPoints = 2;
    const answered = applyUntil(
      engine,
      sAnswer,
      { t: 'ability', unit: WARSONG, abilityId: SONG_OF_WAR, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'chant' && e.die === 3),
    );
    expect(answered.events.find((e) => e.t === 'chant')).toMatchObject({
      die: 3,
      total: 5,
      targetValue: 5,
      answered: true,
      ritualPoints: 0,
    });
    expect(answered.state.units[WARSONG]!.ritualPoints).toBe(0);
    expect(answered.state.effects?.some((e) => e.id === SONG_OF_WAR)).toBe(true);
  });

  it('Banish Manifestation: destroys enemy manifestation within 30" on 7+ and blocks re-summoning that turn', () => {
    const s = baseArena([ALARIELLE, WARSONG, KROAK]);
    s.active = 1;
    placeUnit(scenario, s, KROAK, 30, 22);
    placeUnit(scenario, s, ALARIELLE, 58, 22); // >30" from Kroak so no Unbind during setup

    const summoned = applyUntil(
      engine,
      s,
      { t: 'ability', unit: KROAK, abilityId: SUMMON_SHACKLES },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    const shacklesId = manifestationUnitId(1, WS_SHACKLES);
    const placedShackles = engine.apply(summoned.state, { t: 'pass' }).state;
    expect(placedShackles.units[shacklesId]?.status).toBe('battlefield');

    // Now switch to Player 0's hero phase with Alarielle within 30" of Shackles
    const sBanish = editable(placedShackles);
    sBanish.active = 0;
    sBanish.phase = 'hero';
    sBanish.stack = [];
    sBanish.units[ALARIELLE]!.castsUsed = 0;
    sBanish.units[ALARIELLE]!.abilitiesUsed = [];
    placeUnit(scenario, sBanish, ALARIELLE, 20, 22);

    const banishOpt = engine
      .unitOptions(sBanish, ALARIELLE)
      .find((o) => o.t === 'ability' && o.abilityId === 'banish');
    expect(banishOpt).toMatchObject({
      t: 'ability',
      abilityId: 'banish',
      kind: 'banish',
      targets: [shacklesId],
    });

    const banished = applyUntil(
      engine,
      sBanish,
      { t: 'ability', unit: ALARIELLE, abilityId: 'banish', target: shacklesId },
      (r) => r.events.some((e) => e.t === 'banish' && e.banished),
    );
    expect(banished.state.units[shacklesId]!.status).toBe('destroyed');
    expect(banished.state.banishedThisTurn).toContain(WS_SHACKLES);

    // Even if Player 1 is active this turn, WS_SHACKLES cannot be re-summoned this turn
    const sTryResummon = editable(banished.state);
    sTryResummon.active = 1;
    sTryResummon.units[KROAK]!.castsUsed = 0;
    sTryResummon.units[KROAK]!.abilitiesUsed = [];
    sTryResummon.players[1].spellsAttempted = [];
    expect(
      engine
        .unitOptions(sTryResummon, KROAK)
        .some((o) => o.t === 'ability' && o.abilityId === SUMMON_SHACKLES),
    ).toBe(false);
  });
});

describe('M3a Lore Abilities (16 abilities)', () => {
  describe('Lore of the Deepwood (Sylvaneth Spells)', () => {
    it('Jade Thorns (97df-e136-9fb4-5aca): grants +1 to wound on melee attacks including Companion weapons', () => {
      const s = baseArena([ALARIELLE, DRYADS, SAURUS_GUARD]);
      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: ALARIELLE, abilityId: JADE_THORNS, target: ALARIELLE },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const companionMelee = weapon({
        kind: 'melee',
        abilities: [{ t: 'companion' }],
      });
      const mods = sumModifiers(
        attackModifiers(scenario, r.state, {
          attacker: r.state.units[ALARIELLE]!,
          target: r.state.units[SAURUS_GUARD]!,
          weapon: companionMelee,
          mode: 'fight',
        }),
        companionMelee,
      );
      expect(mods.wound).toBe(1);
    });

    it('Zephyrspite Rush (4ea1-b08a-3684-8d35): target can Run and still Charge later in the turn', () => {
      const s = baseArena([ALARIELLE, DRYADS, SAURUS_GUARD]);
      // Disable end-of-phase CP reactions so passTo goes straight through phases
      s.players[0].cp = 0;
      s.players[1].cp = 0;
      placeUnit(scenario, s, DRYADS, 18, 22);
      placeUnit(scenario, s, SAURUS_GUARD, 32, 22);
      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: ALARIELLE, abilityId: ZEPHYRSPITE_RUSH, target: DRYADS },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      expect(unitGrants(scenario, r.state, r.state.units[DRYADS]!).runAndCharge).toBe(true);

      let st = passTo(engine, r.state, 'movement');
      st = engine.apply(st, { t: 'move', unit: DRYADS, kind: 'run' }).state;
      st = engine.apply(st, { t: 'pass' }).state; // stay in place after run roll
      expect(st.units[DRYADS]!.moved).toBe('run');

      st = passTo(engine, st, 'charge');
      expect(engine.unitOptions(st, DRYADS)).toContainEqual({ t: 'charge' });
    });

    it('Grasping Roots (77cf-59bd-fc8e-f6c7): target enemy cannot Run and has -1 to charge rolls', () => {
      const s = baseArena([ALARIELLE, DRYADS, SAURUS_GUARD]);
      placeUnit(scenario, s, ALARIELLE, 14, 22);
      placeUnit(scenario, s, DRYADS, 12, 22); // >3" from Saurus Guard so Saurus Guard is not in combat
      placeUnit(scenario, s, SAURUS_GUARD, 26, 22);
      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: ALARIELLE, abilityId: GRASPING_ROOTS, target: SAURUS_GUARD },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const grants = unitGrants(scenario, r.state, r.state.units[SAURUS_GUARD]!);
      expect(grants.cannotRun).toBe(true);
      expect(grants.chargeRollModifier).toBe(-1);

      // In Player 1's movement phase, Saurus Guard cannot run
      const p1Move = editable(r.state);
      p1Move.active = 1;
      p1Move.phase = 'movement';
      const moveOpts = engine.unitOptions(p1Move, SAURUS_GUARD);
      expect(moveOpts.some((o) => o.t === 'move' && o.kind === 'normal')).toBe(true);
      expect(moveOpts.some((o) => o.t === 'move' && o.kind === 'run')).toBe(false);

      // In Player 1's charge phase, Saurus Guard charge allowance is dice[0] + dice[1] - 1
      const p1Charge = editable(r.state);
      p1Charge.active = 1;
      p1Charge.phase = 'charge';
      placeUnit(scenario, p1Charge, DRYADS, 14, 22);
      const charged = applyUntil(engine, p1Charge, { t: 'charge', unit: SAURUS_GUARD }, (res) =>
        res.events.some((e) => e.t === 'chargeRoll' && e.success),
      );
      const rollEv = charged.events.find((e) => e.t === 'chargeRoll');
      const d = engine.decision(charged.state);
      expect(rollEv?.t === 'chargeRoll' && d?.kind === 'place' && d.allowance).toBe(
        rollEv?.t === 'chargeRoll' ? rollEv.dice[0] + rollEv.dice[1] - 1 : -99,
      );
    });
  });

  describe('Lore of the Spirit-Song (Sylvaneth Prayers)', () => {
    it('Song Of The Lost (a865-102f-ce95-480c): -1 to wound targeting unit, and on 8+ heals 3 or ignores save modifiers for non-Monster', () => {
      const s = baseArena([WARSONG, DRYADS, DURTHU, SAURUS_GUARD]);
      placeUnit(scenario, s, DURTHU, 15, 26);
      s.units[WARSONG]!.ritualPoints = 5;

      // High chant (8+) on non-Monster Dryads -> ignores save modifiers (including Rend)
      const rNonMonster = applyUntil(
        engine,
        s,
        {
          t: 'ability',
          unit: WARSONG,
          abilityId: SONG_OF_THE_LOST,
          target: DRYADS,
          choice: 'ignoreSaveMods',
        },
        (res) => res.events.some((e) => e.t === 'chant' && e.total >= 8 && e.answered),
      );
      const rendWeapon = weapon({ rend: 2 });
      const mods = weaponMods(
        scenario,
        rNonMonster.state,
        rNonMonster.state.units[SAURUS_GUARD]!,
        rNonMonster.state.units[DRYADS]!,
        rendWeapon,
        'fight',
        { allOutDefence: true },
      );
      expect(mods.wound).toBe(-1);
      expect(rendWeapon.rend + mods.rend).toBe(0); // the weapon's Rend is ignored too
      expect(mods.save).toBe(0);

      // High chant (8+) on damaged Monster Durthu -> heals up to 3, cannot ignoreSaveModifiers
      const sMonster = editable(s);
      sMonster.units[DURTHU]!.damage = 5;
      const rMonster = applyUntil(
        engine,
        sMonster,
        { t: 'ability', unit: WARSONG, abilityId: SONG_OF_THE_LOST, target: DURTHU },
        (res) => res.events.some((e) => e.t === 'chant' && e.total >= 8 && e.answered),
      );
      expect(rMonster.state.units[DURTHU]!.damage).toBe(2);
      expect(
        unitGrants(scenario, rMonster.state, rMonster.state.units[DURTHU]!).ignoreSaveModifiers,
      ).toBeFalsy();
    });

    it('Song Of Dread (4c37-4bd5-f9d5-170a): inflicts D3 mortal damage when target moves ending in creeping overgrowth (and 8+ hits second target)', () => {
      const s = baseArena([WARSONG, SAURUS_GUARD, KROXIGOR]);
      const terrain = scenario.battlefield.terrain.find((t) => t.id === 'outcrop-w')!;
      const [tx, ty] = terrain.polygon[0]!;
      s.overgrown = [scenario.battlefield.terrain.map((t) => t.id), []];
      // Place Warsong 10" away in Y so Saurus Guard is within 18" for the prayer and not in combat (>3")
      placeUnit(scenario, s, SAURUS_GUARD, tx, ty);
      placeUnit(scenario, s, KROXIGOR, tx + 8, ty);
      placeUnit(scenario, s, WARSONG, tx, ty < 22 ? ty + 10 : ty - 10);
      s.units[WARSONG]!.ritualPoints = 5;

      const chanted = applyUntil(
        engine,
        s,
        {
          t: 'ability',
          unit: WARSONG,
          abilityId: SONG_OF_DREAD,
          target: SAURUS_GUARD,
          secondTarget: KROXIGOR,
        },
        (res) => res.events.some((e) => e.t === 'chant' && e.total >= 8 && e.answered),
      );
      expect(
        chanted.state.effects?.filter((e) => e.id === SONG_OF_DREAD).map((e) => e.targetUnit),
      ).toEqual([SAURUS_GUARD, KROXIGOR]);

      // Enemy moves Saurus Guard ending within creeping overgrowth
      const p1Move = editable(chanted.state);
      p1Move.active = 1;
      p1Move.phase = 'movement';
      expect(inCreepingOvergrowth(scenario, p1Move, p1Move.units[SAURUS_GUARD]!, 0, false)).toBe(
        true,
      );
      const declared = engine.apply(p1Move, {
        t: 'move',
        unit: SAURUS_GUARD,
        kind: 'normal',
      }).state;
      const stay = currentPlacement(declared.units[SAURUS_GUARD]!);
      const moved = engine.apply(declared, { t: 'place', placement: stay });
      expect(
        moved.events.some(
          (e) => e.t === 'damage' && e.unit === SAURUS_GUARD && e.source === 'Song Of Dread',
        ),
      ).toBe(true);

      // Owner's ruling, 2026-11-11: a pile-in is not a Move ability; a Power Through move is.
      const dread = (r: { events: { t: string; unit?: string; source?: string }[] }) =>
        r.events.some(
          (e) => e.t === 'damage' && e.unit === SAURUS_GUARD && e.source === 'Song Of Dread',
        );
      for (const [reason, hurts] of [
        ['pileIn', false],
        ['powerThrough', true],
      ] as const) {
        const s2 = editable(chanted.state);
        s2.active = 1;
        s2.phase = reason === 'pileIn' ? 'combat' : 'end';
        s2.stack = [{ t: 'place', unit: SAURUS_GUARD, reason, allowance: 3, dice: [] }];
        const r = engine.apply(s2, { t: 'place', placement: stay });
        expect(dread(r), reason).toBe(hurts);
      }
    });

    it('Song Of War (1b5b-a2e8-6dd3-17fb): adds 1 to Rend of melee weapons (and 10+ affects second target)', () => {
      const s = baseArena([WARSONG, DRYADS, DRYADS_2, SAURUS_GUARD]);
      placeUnit(scenario, s, WARSONG, 16, 22);
      placeUnit(scenario, s, DRYADS, 16, 18); // wholly within 12" of Warsong
      placeUnit(scenario, s, DRYADS_2, 16, 26); // wholly within 12" of Warsong
      s.units[WARSONG]!.ritualPoints = 7;

      const chanted = applyUntil(
        engine,
        s,
        {
          t: 'ability',
          unit: WARSONG,
          abilityId: SONG_OF_WAR,
          target: DRYADS,
          secondTarget: DRYADS_2,
        },
        (res) => res.events.some((e) => e.t === 'chant' && e.total >= 10 && e.answered),
      );
      expect(
        chanted.state.effects?.filter((e) => e.id === SONG_OF_WAR).map((e) => e.targetUnit),
      ).toEqual([DRYADS, DRYADS_2]);
      for (const uid of [DRYADS, DRYADS_2]) {
        const mods = weaponMods(
          scenario,
          chanted.state,
          chanted.state.units[uid]!,
          chanted.state.units[SAURUS_GUARD]!,
          weapon({ kind: 'melee', rend: 1 }),
          'fight',
        );
        expect(mods.rend).toBe(1); // +1 rend modifier on top of base rend
      }
    });
  });

  describe('Lore of Celestial Manipulation (Seraphon Spells)', () => {
    it('Comet\'s Call (78d-5a7e-a6c9-7674): rolls 1D6 per model in target within 18" and inflicts 1 mortal damage per 5+', () => {
      const s = baseArena([DRYADS, KROAK]);
      s.active = 1;
      placeUnit(scenario, s, KROAK, 30, 22);
      placeUnit(scenario, s, DRYADS, 20, 22); // 10 models within 18"

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId: COMETS_CALL, target: DRYADS },
        (res) =>
          res.events.some((e) => e.t === 'cast' && e.success) &&
          res.events.some(
            (e) =>
              e.t === 'roll' &&
              e.label === "Comet's Call" &&
              e.dice.filter((d) => d >= 5).length >= 2,
          ),
      );
      const rollEv = r.events.find((e) => e.t === 'roll' && e.label === "Comet's Call");
      expect(rollEv?.t === 'roll' && rollEv.dice).toHaveLength(10);
      const fives = rollEv?.t === 'roll' ? rollEv.dice.filter((d) => d >= 5).length : 0;
      const dmgEv = r.events.find((e) => e.t === 'damage' && e.source === "Comet's Call");
      expect(dmgEv).toBeDefined();
      expect(r.state.units[DRYADS]!.models.filter((m) => !m.alive).length).toBeGreaterThanOrEqual(
        Math.min(fives, 1),
      );
    });

    it('Mystical Unforging (e0c2-6f59-3b19-9e51): subtracts 1 from Rend of target enemy weapons (clamped at 0 in attack resolution)', () => {
      const s = baseArena([DURTHU, KROAK]);
      s.active = 1;
      placeUnit(scenario, s, KROAK, 30, 22);
      placeUnit(scenario, s, DURTHU, 22, 22);

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId: MYSTICAL_UNFORGING, target: DURTHU },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const mods = weaponMods(
        scenario,
        r.state,
        r.state.units[DURTHU]!,
        r.state.units[KROAK]!,
        weapon({ kind: 'melee', rend: 2 }),
        'fight',
      );
      expect(mods.rend).toBe(-1);
    });

    it('Speed of Huanchi (6086-ce9b-38be-28b2): target friendly Seraphon unit can Run and still Shoot and/or Charge', () => {
      const s = baseArena([DRYADS, KROAK, HUNTERS]);
      s.active = 1;
      s.players[0].cp = 0;
      s.players[1].cp = 0;
      placeUnit(scenario, s, KROAK, 30, 22);
      placeUnit(scenario, s, HUNTERS, 26, 22);
      placeUnit(scenario, s, DRYADS, 15, 22);

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId: SPEED_OF_HUANCHI, target: HUNTERS },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const grants = unitGrants(scenario, r.state, r.state.units[HUNTERS]!);
      expect(grants.runAndShoot).toBe(true);
      expect(grants.runAndCharge).toBe(true);

      let st = passTo(engine, r.state, 'movement');
      st = engine.apply(st, { t: 'move', unit: HUNTERS, kind: 'run' }).state;
      st = engine.apply(st, { t: 'pass' }).state;
      expect(st.units[HUNTERS]!.moved).toBe('run');

      st = passTo(engine, st, 'shooting');
      expect(engine.unitOptions(st, HUNTERS)).toContainEqual({ t: 'shoot' });

      st = passTo(engine, st, 'charge');
      expect(engine.unitOptions(st, HUNTERS)).toContainEqual({ t: 'charge' });
    });
  });

  describe('Aetherwrought Machineries (3 summons)', () => {
    it('Summon Aethervoid Pendulum (678b-96e1-66bb-1de8): summons fcb6-ae80-2e58-aadb wholly within 12" and > 9" from enemies; moves on subsequent turn, cannot charge or fight', () => {
      const s = baseArena([ALARIELLE, SAURUS_GUARD]);
      s.players[0].cp = 0;
      s.players[1].cp = 0;
      placeUnit(scenario, s, ALARIELLE, 20, 22);
      placeUnit(scenario, s, SAURUS_GUARD, 40, 22);

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: ALARIELLE, abilityId: SUMMON_PENDULUM },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const unitId = manifestationUnitId(0, WS_PENDULUM);
      expect(engine.decision(r.state)).toMatchObject({
        kind: 'place',
        unit: unitId,
        reason: 'summon',
        allowance: 12,
      });

      // Placement within 9" of enemy violates ENEMY_COMBAT_RANGE
      const badPlace = { unit: unitId, models: [{ i: 0, x: 35, y: 22, rot: 0 }] };
      expect(engine.checkPlacement(r.state, badPlace).map((v) => v.code)).toContain(
        'ENEMY_COMBAT_RANGE',
      );

      let st = engine.apply(r.state, { t: 'pass' }).state;
      const pendulum = st.units[unitId]!;
      expect(pendulum.profileId).toBe(WS_PENDULUM);
      expect(pendulum.setUpThisTurn).toBe(true);

      // Cannot move on the turn it was set up
      st = passTo(engine, st, 'movement');
      expect(engine.unitOptions(st, unitId)).toEqual([]);

      // On a subsequent turn, it can make a normal move (move: 8) but cannot run, charge, or fight
      st.units[unitId]!.setUpThisTurn = false;
      expect(engine.unitOptions(st, unitId)).toEqual([{ t: 'move', kind: 'normal', allowance: 8 }]);

      st = passTo(engine, st, 'charge');
      placeUnit(
        scenario,
        st,
        SAURUS_GUARD,
        st.units[unitId]!.models[0]!.x + 10,
        st.units[unitId]!.models[0]!.y,
      );
      expect(engine.unitOptions(st, unitId)).toEqual([]);

      st = passTo(engine, st, 'combat');
      placeUnit(
        scenario,
        st,
        SAURUS_GUARD,
        st.units[unitId]!.models[0]!.x + 2,
        st.units[unitId]!.models[0]!.y,
      );
      expect(eligibleFighters(scenario, st, 0).some((u) => u.id === unitId)).toBe(false);
    });

    it('Summon Chronomantic Cogs (c402-d205-c59f-e84b): summons 1aba-bc38-e988-d79f wholly within 12", allowed within 9" of enemies', () => {
      const s = baseArena([ALARIELLE, SAURUS_GUARD]);
      placeUnit(scenario, s, ALARIELLE, 20, 22);
      placeUnit(scenario, s, SAURUS_GUARD, 27, 22); // Only ~7" away from Alarielle

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: ALARIELLE, abilityId: SUMMON_COGS },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const unitId = manifestationUnitId(0, WS_COGS);
      expect(engine.decision(r.state)).toMatchObject({
        kind: 'place',
        unit: unitId,
        reason: 'summon',
        allowance: 12,
      });
      // Placing within 9" of Saurus Guard (without overlapping either unit) is legal because summonMinEnemyGap is 0
      const closePlace = { unit: unitId, models: [{ i: 0, x: 24, y: 17, rot: 0 }] };
      expect(engine.checkPlacement(r.state, closePlace)).toEqual([]);
      const st = engine.apply(r.state, { t: 'place', placement: closePlace }).state;
      expect(st.units[unitId]!.profileId).toBe(WS_COGS);
    });

    it('Summon Quicksilver Swords (d4da-e543-192d-84ae): summons 8cde-fafe-2b2a-ced5 wholly within 12" and > 9" from enemies; mobile manifestation with melee weapons', () => {
      const s = baseArena([ALARIELLE, SAURUS_GUARD]);
      s.players[0].cp = 0;
      s.players[1].cp = 0;
      placeUnit(scenario, s, ALARIELLE, 20, 22);
      placeUnit(scenario, s, SAURUS_GUARD, 40, 22);

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: ALARIELLE, abilityId: SUMMON_SWORDS },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const unitId = manifestationUnitId(0, WS_SWORDS);
      const st = engine.apply(r.state, { t: 'pass' }).state;
      expect(st.units[unitId]!.profileId).toBe(WS_SWORDS);
      expect(profileOf(scenario, st.units[unitId]!).weapons.some((w) => w.kind === 'melee')).toBe(
        true,
      );

      // Can charge when enemy is within charge reach
      const chargeSt = passTo(engine, st, 'charge');
      placeUnit(
        scenario,
        chargeSt,
        SAURUS_GUARD,
        chargeSt.units[unitId]!.models[0]!.x + 8,
        chargeSt.units[unitId]!.models[0]!.y,
      );
      expect(engine.unitOptions(chargeSt, unitId)).toContainEqual({ t: 'charge' });
    });
  });

  describe('Morbid Conjuration (4 summons)', () => {
    it('Summon Purple Sun of Shyish (1b29-60f4-48d2-a6bb): summons e7a5-e611-4c13-22d0', () => {
      const s = baseArena([DRYADS, KROAK]);
      s.active = 1;
      placeUnit(scenario, s, KROAK, 35, 22);
      placeUnit(scenario, s, DRYADS, 10, 22);

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId: SUMMON_PURPLE_SUN },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const unitId = manifestationUnitId(1, WS_PURPLE_SUN);
      const st = engine.apply(r.state, { t: 'pass' }).state;
      expect(st.units[unitId]?.profileId).toBe(WS_PURPLE_SUN);
      expect(st.units[unitId]?.status).toBe('battlefield');
    });

    it('Summon Malevolent Maelstrom (1f2c-ca29-2c5b-24ba): summons e699-49b7-d2b8-d5fc', () => {
      const s = baseArena([DRYADS, KROAK]);
      s.active = 1;
      placeUnit(scenario, s, KROAK, 35, 22);
      placeUnit(scenario, s, DRYADS, 10, 22);

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId: SUMMON_MAELSTROM },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const unitId = manifestationUnitId(1, WS_MAELSTROM);
      const st = engine.apply(r.state, { t: 'pass' }).state;
      expect(st.units[unitId]?.profileId).toBe(WS_MAELSTROM);
      expect(st.units[unitId]?.status).toBe('battlefield');
    });

    it('Summon Soulsnare Shackles (ee70-f212-c079-a752): summons dee3-92a0-27e7-252a wholly within 18" (summonMinEnemyGap: 0)', () => {
      const s = baseArena([DRYADS, KROAK]);
      s.active = 1;
      placeUnit(scenario, s, KROAK, 35, 22);
      placeUnit(scenario, s, DRYADS, 28, 22); // within 9" of Kroak

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId: SUMMON_SHACKLES },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const unitId = manifestationUnitId(1, WS_SHACKLES);
      expect(engine.decision(r.state)).toMatchObject({
        kind: 'place',
        unit: unitId,
        reason: 'summon',
        allowance: 18,
      });
      // Placing within 18" of Kroak and within 9" of Dryads (without overlapping) is legal (range 18", minEnemyGap 0)
      const placement = { unit: unitId, models: [{ i: 0, x: 24, y: 17, rot: 0 }] };
      expect(engine.checkPlacement(r.state, placement)).toEqual([]);
      const st = engine.apply(r.state, { t: 'place', placement }).state;
      expect(st.units[unitId]?.profileId).toBe(WS_SHACKLES);
    });

    it('Summon Suffocating Gravetide (36e0-4b94-aeb-67ac): summons 1885-a1aa-bf5d-6d0d', () => {
      const s = baseArena([DRYADS, KROAK]);
      s.active = 1;
      placeUnit(scenario, s, KROAK, 35, 22);
      placeUnit(scenario, s, DRYADS, 10, 22);

      const r = applyUntil(
        engine,
        s,
        { t: 'ability', unit: KROAK, abilityId: SUMMON_GRAVETIDE },
        (res) => res.events.some((e) => e.t === 'cast' && e.success),
      );
      const unitId = manifestationUnitId(1, WS_GRAVETIDE);
      const st = engine.apply(r.state, { t: 'pass' }).state;
      expect(st.units[unitId]?.profileId).toBe(WS_GRAVETIDE);
      expect(st.units[unitId]?.status).toBe('battlefield');
    });
  });
});

describe('Six Remaining Commands', () => {
  it('forwardToVictory: re-rolls a charge roll in your Charge phase for 1 CP', () => {
    const s = baseArena([DRYADS, SAURUS_GUARD]);
    s.phase = 'charge';
    placeUnit(scenario, s, DRYADS, 18, 22);
    placeUnit(scenario, s, SAURUS_GUARD, 29, 22);

    // Declare charge that fails (short roll)
    const failed = applyUntil(engine, s, { t: 'charge', unit: DRYADS }, (r) =>
      r.events.some((e) => e.t === 'chargeRoll' && !e.success),
    );
    expect(engine.unitOptions(failed.state, DRYADS)).toContainEqual({
      t: 'command',
      command: 'forwardToVictory',
      cost: 1,
    });

    const rerolled = applyUntil(
      engine,
      failed.state,
      { t: 'command', command: 'forwardToVictory', unit: DRYADS },
      (r) => r.events.some((e) => e.t === 'chargeRoll' && e.success),
    );
    expect(rerolled.state.players[0].cp).toBe(3);
    expect(rerolled.events[0]).toEqual({
      t: 'command',
      player: 0,
      command: 'forwardToVictory',
      unit: DRYADS,
    });
    expect(engine.decision(rerolled.state)).toMatchObject({
      kind: 'place',
      unit: DRYADS,
      reason: 'charge',
    });
  });

  it('redeploy: moves a unit not in combat up to D6" in the enemy Movement phase for 1 CP', () => {
    const s = baseArena([DRYADS, SAURUS_GUARD]);
    s.phase = 'movement';
    placeUnit(scenario, s, DRYADS, 18, 22);
    placeUnit(scenario, s, SAURUS_GUARD, 32, 22);

    // Active player moves Dryads 2" to end within 6" of Saurus Guard (but > 3")
    const moveDecl = engine.apply(s, { t: 'move', unit: DRYADS, kind: 'normal' }).state;
    const closer = shiftPlacement(currentPlacement(moveDecl.units[DRYADS]!), 2, 0);
    const moved = engine.apply(moveDecl, { t: 'place', placement: closer });

    expect(engine.decision(moved.state)).toEqual({
      kind: 'reaction',
      player: 1,
      options: [{ command: 'redeploy', unit: SAURUS_GUARD, cost: 1 }],
      trigger: `move:${DRYADS}`,
    });

    const redeployed = engine.apply(moved.state, {
      t: 'command',
      command: 'redeploy',
      unit: SAURUS_GUARD,
    });
    expect(redeployed.state.players[1].cp).toBe(3);
    const rollEv = redeployed.events.find((e) => e.t === 'roll' && e.label === 'Redeploy');
    expect(rollEv).toBeDefined();
    const allowance = rollEv?.t === 'roll' ? rollEv.dice[0]! : 0;
    expect(engine.decision(redeployed.state)).toMatchObject({
      kind: 'place',
      player: 1,
      unit: SAURUS_GUARD,
      reason: 'normal',
      allowance,
    });
  });

  it('coveringFire: shoots the closest enemy unit in the enemy Shooting phase with -1 to hit for 1 CP', () => {
    const s = baseArena([DRYADS, DURTHU, HUNTERS]);
    s.phase = 'shooting';
    placeUnit(scenario, s, DRYADS, 16, 22); // closer to Hunters (outside 3" combat range, within 10" dartpipe range)
    placeUnit(scenario, s, DURTHU, 8, 22); // further from Hunters
    placeUnit(scenario, s, HUNTERS, 26, 22);
    // Mark that active player had activity so Covering Fire is offered at end of shooting phase
    s.units[DRYADS]!.moved = 'normal';
    s.players[0].cp = 0; // no All-out Defence prompt for Player 0

    const passed = engine.apply(s, { t: 'pass' });
    expect(engine.decision(passed.state)).toEqual({
      kind: 'reaction',
      player: 1,
      options: [{ command: 'coveringFire', unit: HUNTERS, cost: 1 }],
      trigger: 'phase:shooting',
    });

    const fired = engine.apply(passed.state, {
      t: 'command',
      command: 'coveringFire',
      unit: HUNTERS,
    });
    expect(fired.state.players[1].cp).toBe(3);
    // Must target closest unit (DRYADS) and phase advances to 'charge' after settling endPhase
    const attackEv = fired.events.find((e) => e.t === 'attacks');
    expect(attackEv).toMatchObject({
      t: 'attacks',
      attacker: HUNTERS,
      target: DRYADS,
      mode: 'shoot',
    });
    expect(fired.state.phase).toBe('charge');

    // Verify -1 to hit modifier from coveringFire
    const mods = weaponMods(
      scenario,
      s,
      s.units[HUNTERS]!,
      s.units[DRYADS]!,
      profileOf(scenario, s.units[HUNTERS]!).weapons.find((w) => w.kind === 'ranged')!,
      'shoot',
      { coveringFire: true },
    );
    expect(mods.hit).toBe(-1);
  });

  it('counterCharge: charges with a unit not in combat in the enemy Charge phase for 2 CP', () => {
    const s = baseArena([DRYADS, SAURUS_GUARD]);
    s.phase = 'charge';
    placeUnit(scenario, s, DRYADS, 16, 22);
    placeUnit(scenario, s, SAURUS_GUARD, 27, 22); // within 6" of Dryads, not in combat (>3")

    const passed = engine.apply(s, { t: 'pass' });
    expect(engine.decision(passed.state)).toEqual({
      kind: 'reaction',
      player: 1,
      options: [{ command: 'counterCharge', unit: SAURUS_GUARD, cost: 2 }],
      trigger: 'phase:charge',
    });

    const countered = applyUntil(
      engine,
      passed.state,
      { t: 'command', command: 'counterCharge', unit: SAURUS_GUARD },
      (r) => r.events.some((e) => e.t === 'chargeRoll' && e.dice[0] + e.dice[1] >= 10),
    );
    expect(countered.state.players[1].cp).toBe(2);
    expect(engine.decision(countered.state)).toMatchObject({
      kind: 'place',
      player: 1,
      unit: SAURUS_GUARD,
      reason: 'charge',
    });
    const placement = chargePlacement(engine, countered.state, SAURUS_GUARD)!;
    const afterPlace = engine.apply(countered.state, { t: 'place', placement }).state;
    expect(afterPlace.units[SAURUS_GUARD]!.charged).toBe(true);
    expect(afterPlace.phase).toBe('combat');
  });

  it('magicalIntervention: casts a spell or chants a prayer in the enemy Hero phase at -1 to the roll for 1 CP', () => {
    const s = baseArena([DRYADS, KROAK]);
    placeUnit(scenario, s, DRYADS, 20, 22);
    placeUnit(scenario, s, KROAK, 30, 22); // within 18" of Dryads

    const passed = engine.apply(s, { t: 'pass' });
    expect(engine.decision(passed.state)).toEqual({
      kind: 'reaction',
      player: 1,
      options: [{ command: 'magicalIntervention', unit: KROAK, cost: 1 }],
      trigger: 'phase:hero',
    });

    const intervened = engine.apply(passed.state, {
      t: 'command',
      command: 'magicalIntervention',
      unit: KROAK,
    });
    expect(intervened.state.players[1].cp).toBe(3);
    expect(engine.decision(intervened.state)).toEqual({
      kind: 'main',
      player: 1,
      phase: 'hero',
    });

    // Cast Mystical Unforging (CV 6) via Magical Intervention: total = dice[0] + dice[1] - 1
    const castRes = applyUntil(
      engine,
      intervened.state,
      { t: 'ability', unit: KROAK, abilityId: MYSTICAL_UNFORGING, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && e.dice[0] + e.dice[1] === 7),
    );
    const castEv = castRes.events.find((e) => e.t === 'cast');
    expect(castEv).toMatchObject({
      t: 'cast',
      unit: KROAK,
      total: 6,
      targetValue: 6,
      success: true,
    });
    expect(castRes.state.phase).toBe('movement');
  });

  it('powerThrough: in the End of Turn phase, a unit that charged inflicts D3 mortal damage on an engaged enemy with lower Health and moves out of combat for 1 CP', () => {
    const s = baseArena([DURTHU, SAURUS_GUARD, KROXIGOR]);
    s.phase = 'end';
    // Durthu (Health 14) charged and is in combat with Saurus Guard (Health 2)
    placeUnit(scenario, s, DURTHU, 18, 22);
    placeUnit(scenario, s, SAURUS_GUARD, 24, 22);
    placeUnit(scenario, s, KROXIGOR, 18, 31); // not in combat with Durthu
    s.units[DURTHU]!.charged = true;
    expect(inCombat(scenario, s, s.units[DURTHU]!)).toBe(true);

    expect(engine.unitOptions(s, DURTHU).filter((o) => o.t === 'command')).toEqual([
      { t: 'command', command: 'powerThrough', cost: 1, targets: [SAURUS_GUARD] },
    ]);

    const powered = engine.apply(s, {
      t: 'command',
      command: 'powerThrough',
      unit: DURTHU,
      target: SAURUS_GUARD,
    });
    expect(powered.state.players[0].cp).toBe(3);
    expect(
      powered.events.some(
        (e) => e.t === 'damage' && e.unit === SAURUS_GUARD && e.source === 'Power Through',
      ),
    ).toBe(true);
    expect(engine.decision(powered.state)).toMatchObject({
      kind: 'place',
      unit: DURTHU,
      reason: 'powerThrough',
      allowance: profileOf(scenario, s.units[DURTHU]!).move,
    });

    // Owner's ruling, 2026-11-11: it may stay in combat with the unit it was fighting...
    const stayInCombat = currentPlacement(powered.state.units[DURTHU]!);
    expect(inCombat(scenario, powered.state, powered.state.units[KROXIGOR]!)).toBe(false);
    expect(engine.checkPlacement(powered.state, stayInCombat)).toEqual([]);
    // ...but not enter combat with a unit it was not already in combat with.
    const intoKroxigor = shiftPlacement(stayInCombat, 0, 4);
    expect(engine.checkPlacement(powered.state, intoKroxigor).map((v) => v.message)).toContain(
      'Power Through cannot end in combat with a unit it was not already in combat with.',
    );

    // Moving 5" away ends out of combat and is legal
    const moveAway = shiftPlacement(stayInCombat, -5, 0);
    expect(engine.checkPlacement(powered.state, moveAway)).toEqual([]);
    const finished = engine.apply(powered.state, { t: 'place', placement: moveAway }).state;
    expect(inCombat(scenario, finished, finished.units[DURTHU]!)).toBe(false);
  });
});

describe('Strike-first / Strike-last Combat Order', () => {
  it('fights STRIKE-FIRST before normal before STRIKE-LAST, cancels both to normal, and resets first pick to state.active on tier change', () => {
    const s = baseArena([ALARIELLE, DURTHU, DRYADS, SAURUS_GUARD, KROXIGOR, HUNTERS]);
    s.phase = 'combat';
    s.fightPicker = 0;
    s.fightTier = null;
    // Engage pairs in combat
    placeUnit(scenario, s, DURTHU, 15, 10);
    placeUnit(scenario, s, SAURUS_GUARD, 17, 10);
    placeUnit(scenario, s, ALARIELLE, 15, 22);
    placeUnit(scenario, s, KROXIGOR, 17, 22);
    placeUnit(scenario, s, DRYADS, 15, 34);
    placeUnit(scenario, s, HUNTERS, 17, 34);
    s.players[0].cp = 0;
    s.players[1].cp = 0;

    const sgProf = scenario.profiles[s.units[SAURUS_GUARD]!.profileId]!;
    const dProf = scenario.profiles[s.units[DRYADS]!.profileId]!;
    const hProf = scenario.profiles[s.units[HUNTERS]!.profileId]!;
    const origSg = [...sgProf.keywords];
    const origD = [...dProf.keywords];
    const origH = [...hProf.keywords];

    sgProf.keywords = [...origSg, 'STRIKE-FIRST'];
    dProf.keywords = [...origD, 'STRIKE-LAST'];
    hProf.keywords = [...origH, 'STRIKE-FIRST', 'STRIKE-LAST'];

    try {
      // 1. Having both STRIKE-FIRST and STRIKE-LAST cancels out to 'normal'
      expect(strikeOrder(scenario, s, s.units[SAURUS_GUARD]!)).toBe('strikeFirst');
      expect(strikeOrder(scenario, s, s.units[ALARIELLE]!)).toBe('normal');
      expect(strikeOrder(scenario, s, s.units[HUNTERS]!)).toBe('normal');
      expect(strikeOrder(scenario, s, s.units[DRYADS]!)).toBe('strikeLast');

      // 2. Strike-first tier goes first: only Player 1 has a strikeFirst unit (SAURUS_GUARD), so Player 1 picks first
      expect(currentFightTier(scenario, s)).toBe('strikeFirst');
      expect(engine.decision(s)).toEqual({ kind: 'fightPick', player: 1, canPass: false });
      expect(eligibleFighters(scenario, s, 1).map((u) => u.id)).toEqual([SAURUS_GUARD]);

      // Saurus Guard fights
      let st = engine.apply(s, { t: 'fight', unit: SAURUS_GUARD }).state;
      st = engine.apply(st, { t: 'pass' }).state; // skip pile-in
      st = engine.apply(st, engine.defaultAction(st)).state; // resolve attacks

      // 3. Entering the 'normal' tier resets first pick to state.active (Player 0)
      expect(currentFightTier(scenario, st)).toBe('normal');
      st.fightPicker = 1; // Simulate last picker in strikeFirst being Player 0 so fightPicker became 1
      expect(engine.decision(st)).toEqual({ kind: 'fightPick', player: 0, canPass: false });

      // Mark all normal units as fought to transition to strikeLast
      st.units[DURTHU]!.fought = true;
      st.units[ALARIELLE]!.fought = true;
      st.units[KROXIGOR]!.fought = true;
      st.units[HUNTERS]!.fought = true;
      st.fightTier = 'normal';
      st.fightPicker = 1;

      // 4. Normal units fight before STRIKE-LAST units; now only DRYADS (strikeLast) remains
      expect(currentFightTier(scenario, st)).toBe('strikeLast');
      expect(eligibleFighters(scenario, st, 0).map((u) => u.id)).toEqual([DRYADS]);
      expect(engine.decision(st)).toEqual({ kind: 'fightPick', player: 0, canPass: false });
    } finally {
      sgProf.keywords = origSg;
      dProf.keywords = origD;
      hProf.keywords = origH;
    }
  });
});

describe('Warscroll Spells (Wizard-Specific)', () => {
  const METAMORPHOSIS = 'b4bf-ef71-9dfe-e837';
  const ENRAGE_THE_SPITES = 'a924-fd6e-9278-4d4c';
  const CELESTIAL_DELIVERANCE = 'f7bf-5a9-2828-a74';
  const CELESTIAL_DOOM = '2209-9b15-d3f-15ed';

  it('Metamorphosis (Alarielle only): inflicts 2D3 mortal damage within 12" and overgrows closest terrain or splashes D3 on kill', () => {
    const s = baseArena([ALARIELLE, DRYCHA, SAURUS_GUARD, HUNTERS]);
    placeUnit(scenario, s, ALARIELLE, 20, 22);
    placeUnit(scenario, s, SAURUS_GUARD, 28, 22);
    placeUnit(scenario, s, HUNTERS, 30, 22);

    // Only Alarielle knows Metamorphosis; Drycha does not
    expect(
      engine
        .unitOptions(s, ALARIELLE)
        .some((o) => o.t === 'ability' && o.abilityId === METAMORPHOSIS),
    ).toBe(true);
    expect(
      engine.unitOptions(s, DRYCHA).some((o) => o.t === 'ability' && o.abilityId === METAMORPHOSIS),
    ).toBe(false);

    // Leave only 1 model with 1 health remaining in SAURUS_GUARD so Metamorphosis destroys it
    for (let i = 1; i < s.units[SAURUS_GUARD]!.models.length; i++) {
      s.units[SAURUS_GUARD]!.models[i]!.alive = false;
    }
    s.units[SAURUS_GUARD]!.damage = 1;
    const tokensBefore = s.overgrown?.[0]?.length ?? 0;

    const res = applyUntil(
      engine,
      s,
      { t: 'ability', unit: ALARIELLE, abilityId: METAMORPHOSIS, target: SAURUS_GUARD },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    expect(res.state.units[SAURUS_GUARD]!.status).toBe('destroyed');
    expect(res.state.overgrown?.[0]).toHaveLength(tokensBefore + 1);
  });

  it('Enrage The Spites (Drycha only): hits up to 3 enemies within 12" or in creeping overgrowth with D3 mortal damage each', () => {
    const s = baseArena([ALARIELLE, DRYCHA, SAURUS_GUARD, KROXIGOR, HUNTERS]);
    placeUnit(scenario, s, DRYCHA, 20, 22);
    placeUnit(scenario, s, SAURUS_GUARD, 27, 19);
    placeUnit(scenario, s, KROXIGOR, 27, 25);
    // Place HUNTERS outside 12" (at x=48) but near an overgrown terrain feature
    const terrain = scenario.battlefield.terrain[0]!;
    const [tx, ty] = terrain.polygon[0]!;
    s.overgrown = [[terrain.id], []];
    placeUnit(scenario, s, HUNTERS, tx, ty);

    // Only Drycha knows Enrage The Spites; Alarielle does not
    const drychaOpt = engine
      .unitOptions(s, DRYCHA)
      .find((o) => o.t === 'ability' && o.abilityId === ENRAGE_THE_SPITES);
    expect(drychaOpt).toBeDefined();
    expect(
      engine
        .unitOptions(s, ALARIELLE)
        .some((o) => o.t === 'ability' && o.abilityId === ENRAGE_THE_SPITES),
    ).toBe(false);

    const res = applyUntil(
      engine,
      s,
      { t: 'ability', unit: DRYCHA, abilityId: ENRAGE_THE_SPITES, target: SAURUS_GUARD },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    const damagedIds = res.events
      .filter((e) => e.t === 'damage' && e.source === 'Enrage The Spites')
      .map((e) => (e.t === 'damage' ? e.unit : ''));
    expect(damagedIds).toHaveLength(3);
    expect(damagedIds).toEqual(expect.arrayContaining([SAURUS_GUARD, KROXIGOR, HUNTERS]));
  });

  it('Celestial Deliverance (Lord Kroak only): hits up to 3 enemies within 18" for D3 mortal damage and can be cast multiple times per phase', () => {
    const s = baseArena([DRYADS, DRYADS_2, DURTHU, KROAK, STARSEER]);
    s.active = 1;
    placeUnit(scenario, s, KROAK, 30, 22);
    placeUnit(scenario, s, STARSEER, 55, 22);
    placeUnit(scenario, s, DRYADS, 20, 18);
    placeUnit(scenario, s, DRYADS_2, 20, 22);
    placeUnit(scenario, s, DURTHU, 20, 26);

    // Only Kroak knows Celestial Deliverance; Starseer does not
    expect(
      engine
        .unitOptions(s, KROAK)
        .some((o) => o.t === 'ability' && o.abilityId === CELESTIAL_DELIVERANCE),
    ).toBe(true);
    expect(
      engine
        .unitOptions(s, STARSEER)
        .some((o) => o.t === 'ability' && o.abilityId === CELESTIAL_DELIVERANCE),
    ).toBe(false);

    // First cast hits all 3 enemy units within 18"
    const cast1 = applyUntil(
      engine,
      s,
      { t: 'ability', unit: KROAK, abilityId: CELESTIAL_DELIVERANCE, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    const hit1 = cast1.events.filter(
      (e) => e.t === 'damage' && e.source === 'Celestial Deliverance',
    );
    expect(hit1).toHaveLength(3);
    expect(cast1.state.units[KROAK]!.castsUsed).toBe(1);

    // Kroak can cast Celestial Deliverance a second time in the same phase!
    expect(
      engine
        .unitOptions(cast1.state, KROAK)
        .some((o) => o.t === 'ability' && o.abilityId === CELESTIAL_DELIVERANCE),
    ).toBe(true);
    const cast2 = applyUntil(
      engine,
      cast1.state,
      { t: 'ability', unit: KROAK, abilityId: CELESTIAL_DELIVERANCE, target: DURTHU },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    expect(cast2.state.units[KROAK]!.castsUsed).toBe(2);
  });

  it('Celestial Doom (Skink Starseer only): disables ward rolls on the target for the rest of the turn', () => {
    const s = baseArena([ALARIELLE, KROAK, STARSEER]);
    s.active = 1;
    placeUnit(scenario, s, STARSEER, 30, 22);
    placeUnit(scenario, s, KROAK, 55, 22);
    placeUnit(scenario, s, ALARIELLE, 20, 22); // Alarielle has native 5+ Ward

    // Only Starseer knows Celestial Doom; Kroak does not
    expect(
      engine
        .unitOptions(s, STARSEER)
        .some((o) => o.t === 'ability' && o.abilityId === CELESTIAL_DOOM),
    ).toBe(true);
    expect(
      engine.unitOptions(s, KROAK).some((o) => o.t === 'ability' && o.abilityId === CELESTIAL_DOOM),
    ).toBe(false);

    // Before casting, Alarielle has her 5+ ward
    expect(unitGrants(scenario, s, s.units[ALARIELLE]!).ward).toBe(5);
    expect(unitGrants(scenario, s, s.units[ALARIELLE]!).disableWard).toBeUndefined();

    const cast = applyUntil(
      engine,
      s,
      { t: 'ability', unit: STARSEER, abilityId: CELESTIAL_DOOM, target: ALARIELLE },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    const afterDoom =
      engine.decision(cast.state)?.kind === 'reaction'
        ? engine.apply(cast.state, { t: 'pass' }).state
        : cast.state;
    expect(unitGrants(scenario, afterDoom, afterDoom.units[ALARIELLE]!).disableWard).toBe(true);

    // Subsequent mortal damage on Alarielle makes NO Ward roll
    afterDoom.units[ALARIELLE]!.castsUsed = 3; // no unbind left
    placeUnit(scenario, afterDoom, KROAK, 28, 22);
    const nuked = applyUntil(
      engine,
      afterDoom,
      { t: 'ability', unit: KROAK, abilityId: CELESTIAL_DELIVERANCE, target: ALARIELLE },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    expect(nuked.events.some((e) => e.t === 'roll' && e.label === 'Ward')).toBe(false);
  });
});

describe('Once-Per-Phase Command Restrictions (Per Unit & Per Army)', () => {
  it('cannot use All-out Attack with two different units in the same phase, or on a unit that already used All-out Defence that phase', () => {
    const s = baseArena([DURTHU, DRYCHA, SAURUS_GUARD, KROXIGOR]);
    s.phase = 'combat';
    s.fightPicker = 0;
    s.fightTier = null;
    placeUnit(scenario, s, DURTHU, 20, 18);
    placeUnit(scenario, s, SAURUS_GUARD, 22, 18);
    placeUnit(scenario, s, DRYCHA, 20, 28);
    placeUnit(scenario, s, KROXIGOR, 22, 28);

    // 1. Durthu fights first and uses All-out Attack; Saurus Guard reacts with All-out Defence
    let st = engine.apply(s, { t: 'fight', unit: DURTHU }).state;
    st = engine.apply(st, { t: 'pass' }).state; // skip pile-in
    const durthuAllocs = engine.targetOptions(st, DURTHU, 'fight').map((w) => ({
      weaponId: w.weaponId,
      target: w.targets[0]!.unit,
    }));
    st = engine.apply(st, { t: 'targets', allocations: durthuAllocs, allOutAttack: true }).state;
    // Saurus Guard uses All-out Defence reaction
    st = engine.apply(st, { t: 'command', command: 'allOutDefence', unit: SAURUS_GUARD }).state;

    // 2. Saurus Guard now picks to fight in the same Combat phase -> CANNOT also use All-out Attack because it already used All-out Defence this phase
    st = engine.apply(st, { t: 'fight', unit: SAURUS_GUARD }).state;
    st = engine.apply(st, { t: 'pass' }).state; // skip pile-in
    const sgAllocs = engine.targetOptions(st, SAURUS_GUARD, 'fight').map((w) => ({
      weaponId: w.weaponId,
      target: w.targets[0]!.unit,
    }));
    expect(() =>
      engine.apply(st, { t: 'targets', allocations: sgAllocs, allOutAttack: true }),
    ).toThrow(/already used a command this phase/);
    st = engine.apply(st, { t: 'targets', allocations: sgAllocs, allOutAttack: false }).state;

    // 3. Drycha now picks to fight for Player 0 in the same Combat phase -> CANNOT use All-out Attack because Player 0 already used All-out Attack with Durthu this phase
    st = engine.apply(st, { t: 'fight', unit: DRYCHA }).state;
    st = engine.apply(st, { t: 'pass' }).state; // skip pile-in
    const drychaAllocs = engine.targetOptions(st, DRYCHA, 'fight').map((w) => ({
      weaponId: w.weaponId,
      target: w.targets[0]!.unit,
    }));
    expect(() =>
      engine.apply(st, { t: 'targets', allocations: drychaAllocs, allOutAttack: true }),
    ).toThrow(/All-out Attack has already been used this phase/);
  });

  it('using Magical Intervention with Drycha in the enemy Hero phase prevents also Rallying Drycha that phase (while another unit can still Rally)', () => {
    const s = baseArena([DRYCHA, DRYADS, SAURUS_GUARD]);
    s.active = 1; // Enemy (Seraphon) Hero phase
    s.phase = 'hero';
    placeUnit(scenario, s, DRYCHA, 20, 22);
    placeUnit(scenario, s, SAURUS_GUARD, 32, 22); // within 18" of Drycha, > 3" away
    placeUnit(scenario, s, DRYADS, 10, 10);
    // Both Drycha and Dryads are damaged and not in combat
    s.units[DRYCHA]!.damage = 3;
    s.units[DRYADS]!.models[9]!.alive = false;

    // Opponent passes their Hero phase -> Player 0 gets end-of-hero-phase reaction with Magical Intervention (Drycha) and Rally (Drycha, Dryads)
    const afterEnemyPass = engine.apply(s, { t: 'pass' }).state;
    expect(engine.decision(afterEnemyPass)).toEqual({
      kind: 'reaction',
      player: 0,
      options: [
        { command: 'magicalIntervention', unit: DRYCHA, cost: 1 },
        { command: 'rally', unit: DRYCHA, cost: 1 },
        { command: 'rally', unit: DRYADS, cost: 1 },
      ],
      trigger: 'phase:hero',
    });

    // Player 0 uses Magical Intervention with Drycha
    const afterMi = engine.apply(afterEnemyPass, {
      t: 'command',
      command: 'magicalIntervention',
      unit: DRYCHA,
    }).state;
    expect(afterMi.units[DRYCHA]!.commandUsed).toBe('magicalIntervention');

    // Drycha casts Grasping Roots (or passes) to finish Magical Intervention
    const afterCast = engine.apply(afterMi, {
      t: 'ability',
      unit: DRYCHA,
      abilityId: GRASPING_ROOTS,
      target: SAURUS_GUARD,
    }).state;

    // Now the remaining end-of-hero-phase reaction offers Rally ONLY for Dryads — NOT Drycha (and NOT Magical Intervention again)
    expect(engine.decision(afterCast)).toEqual({
      kind: 'reaction',
      player: 0,
      options: [{ command: 'rally', unit: DRYADS, cost: 1 }],
      trigger: 'phase:hero',
    });
    expect(() =>
      engine.apply(afterCast, { t: 'command', command: 'rally', unit: DRYCHA }),
    ).toThrow();
  });
});

describe('reaction offers (owner ruling, 2026-11-11)', () => {
  const offered = (s: GameState, command: string) => {
    const d = engine.decision(s);
    return d?.kind === 'reaction' && d.options.some((o) => o.command === command);
  };

  it('Covering Fire: not for a unit that ran or is in combat', () => {
    const base = baseArena([DRYADS, DURTHU, HUNTERS]);
    base.phase = 'shooting';
    placeUnit(scenario, base, DRYADS, 16, 22);
    placeUnit(scenario, base, DURTHU, 8, 22);
    placeUnit(scenario, base, HUNTERS, 26, 22);
    base.units[DRYADS]!.moved = 'normal';
    base.players[0].cp = 0;
    expect(offered(engine.apply(base, { t: 'pass' }).state, 'coveringFire')).toBe(true);
    const ran = editable(base);
    ran.units[HUNTERS]!.moved = 'run';
    expect(offered(engine.apply(ran, { t: 'pass' }).state, 'coveringFire')).toBe(false);
    const engaged = editable(base);
    placeUnit(scenario, engaged, DRYADS, 23.5, 22);
    expect(offered(engine.apply(engaged, { t: 'pass' }).state, 'coveringFire')).toBe(false);
  });

  it('Magical Intervention: offered with no enemy within 18", and it offers Banish', () => {
    const s = baseArena([ALARIELLE, KROAK]);
    placeUnit(scenario, s, ALARIELLE, 6, 22);
    placeUnit(scenario, s, KROAK, 55, 22); // 49" away
    const after = engine.apply(s, { t: 'pass' }).state;
    expect(offered(after, 'magicalIntervention')).toBe(true);
    // Banish through Magical Intervention: an enemy manifestation within 30".
    const t = editable(s);
    t.active = 1;
    placeUnit(scenario, t, KROAK, 30, 22);
    placeUnit(scenario, t, ALARIELLE, 58, 22);
    const summoned = applyUntil(
      engine,
      t,
      { t: 'ability', unit: KROAK, abilityId: SUMMON_SHACKLES },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    const placed = editable(engine.apply(summoned.state, { t: 'pass' }).state);
    placed.active = 1;
    placed.phase = 'hero';
    placeUnit(scenario, placed, ALARIELLE, 20, 22);
    placed.stack = [{ t: 'magicalIntervention', unit: ALARIELLE }];
    expect(
      engine.unitOptions(placed, ALARIELLE).some((o) => o.t === 'ability' && o.kind === 'banish'),
    ).toBe(true);
  });

  it('Redeploy: offered after each enemy move, at any distance, until used', () => {
    const s = passTo(engine, baseArena([DRYADS, DURTHU, SAURUS_GUARD, KROXIGOR]), 'movement');
    placeUnit(scenario, s, DRYADS, 6, 10);
    placeUnit(scenario, s, DURTHU, 6, 34);
    placeUnit(scenario, s, SAURUS_GUARD, 54, 10);
    placeUnit(scenario, s, KROXIGOR, 54, 34);
    let st = s;
    for (const unit of [DRYADS, DURTHU]) {
      st = engine.apply(st, { t: 'move', unit, kind: 'normal' }).state;
      st = engine.apply(st, { t: 'place', placement: currentPlacement(st.units[unit]!) }).state;
      expect(offered(st, 'redeploy'), unit).toBe(true);
      st = engine.apply(st, { t: 'pass' }).state;
    }
  });
});
