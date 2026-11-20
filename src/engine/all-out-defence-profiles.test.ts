/**
 * B6 (owner, 2026-11-20): All-out Defence is offered once, before any of the attacking unit's
 * weapon profiles is rolled, and it counts for every profile of that unit's attacks.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { weaponMods } from './combat.js';
import { createEngine, createScenario, profileOf, type GameState } from './index.js';
import { editable, keepOnly, passTo, placeUnit, skipWindows, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const ALARIELLE = '0:0';
const BASTILADON = '1:7'; // Bludgeoning Tail + Ark of Sotek

/** Combat phase, the Bastiladon about to be picked to fight Alarielle, who has 3 CP. */
function arena(): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, [ALARIELLE, BASTILADON]);
  placeUnit(scenario, s, ALARIELLE, 20, 22, 90);
  placeUnit(scenario, s, BASTILADON, 23.5, 22, 270);
  s.players[0].cp = 3;
  s.players[1].cp = 0;
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  // The defender's Ark of Sotek is offered in the start-of-combat window (R14): passed here.
  const t = editable(skipWindows(engine, passTo(engine, s, 'combat')));
  t.units[ALARIELLE]!.fought = true;
  return t;
}

/** Plays on to the All-out Defence question, returning that state and the attack events seen so far. */
function toReaction(s: GameState) {
  let t = s;
  const attacksBefore: string[] = [];
  for (let i = 0; i < 10; i++) {
    const d = engine.decision(t);
    if (d?.kind === 'reaction') return { t, attacksBefore };
    const r = engine.apply(t, engine.defaultAction(t));
    for (const e of r.events) if (e.t === 'attacks') attacksBefore.push(e.weapon);
    t = r.state;
  }
  throw new Error('no reaction');
}

describe('All-out Defence against a unit with several weapon profiles', () => {
  it('is asked once, before the first profile is rolled, and the unit has two profiles', () => {
    const { t, attacksBefore } = toReaction(arena());
    expect(attacksBefore).toEqual([]);
    expect(engine.decision(t)).toMatchObject({
      kind: 'reaction',
      player: 0,
      trigger: `fight:${BASTILADON}`,
      options: [{ command: 'allOutDefence', unit: ALARIELLE, cost: 1 }],
    });
    const r = engine.apply(t, { t: 'command', command: 'allOutDefence', unit: ALARIELLE });
    const weapons = r.events
      .filter((e) => e.t === 'attacks')
      .map((e) => (e.t === 'attacks' ? e.weapon : ''));
    expect(weapons).toEqual(['Bludgeoning Tail', 'Ark of Sotek']);
    // Nothing further asks for All-out Defence once the attacks are through.
    expect(engine.decision(r.state)).not.toMatchObject({ kind: 'reaction' });
  });

  it('gives +1 to the save against each profile', () => {
    const s = arena();
    const attacker = s.units[BASTILADON]!;
    const target = s.units[ALARIELLE]!;
    const weapons = profileOf(scenario, attacker).weapons.filter((w) => w.range <= 3);
    expect(weapons.length).toBeGreaterThanOrEqual(2);
    for (const w of weapons) {
      const plain = weaponMods(scenario, s, attacker, target, w, 'fight', {});
      const defended = weaponMods(scenario, s, attacker, target, w, 'fight', {
        allOutDefence: true,
      });
      expect(defended.save).toBe(plain.save + 1);
    }
  });
});
