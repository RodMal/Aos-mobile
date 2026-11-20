/**
 * M4m (owner ruling I74): faction terrain acts through its abilities only. One block per ability:
 * Vengeful Forest Spirits (Awakened Wyldwood), Fierce Guardians and Power Unleashed (Realmshaper
 * Engine). The terrain still never moves or fights (`factionTerrain.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { attackModifiers } from '../rules/core/modifiers.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  unitDistance,
  type GameState,
} from './index.js';
import {
  FIERCE_GUARDIANS_ID,
  POWER_UNLEASHED_ID,
  powerGroups,
  VENGEFUL_FOREST_SPIRITS_ID,
} from './factionTerrainActive.js';
import { profileOf } from './query.js';
import type { Action, GameEvent, UnitId } from './types.js';
import {
  applyUntil,
  editable,
  enterCombat,
  keepOnly,
  placeUnit,
  startGame,
} from './test-helpers.js';

const scenario = createScenario([SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN]);
const engine = createEngine(scenario);

const ENGINE_T = '0:terrain';
const WYLDWOOD = '1:terrain';
const STARSEER = '0:6';
const WARRIORS = '0:5';
const BASTILADON = '0:7';
const BELTHANOS = '1:1';
const DRYADS = '1:6';
const DRYADS2 = '1:7';
const SPITES = '1:4';

function arena(
  at: Record<string, [number, number, number?]>,
  phase: GameState['phase'],
  active: 0 | 1 = 0,
): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y, facing]] of Object.entries(at)) placeUnit(scenario, s, id, x, y, facing);
  s.active = active;
  s.phase = phase;
  s.stack = [];
  s.players[0].cp = 0;
  s.players[1].cp = 0;
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return s;
}

/** Slides `mover` along x so that its edge-to-edge gap to `fixed` is `gap` (it stands to its right). */
function gapTo(s: GameState, mover: UnitId, fixed: UnitId, gap: number): void {
  const now = unitDistance(scenario, s.units[mover]!, s.units[fixed]!);
  for (const m of s.units[mover]!.models) m.x -= now - gap;
  expect(Math.abs(unitDistance(scenario, s.units[mover]!, s.units[fixed]!) - gap)).toBeLessThan(
    0.2,
  );
}

const rolls = (events: GameEvent[], label: string): number[] =>
  events.flatMap((e) => (e.t === 'roll' && e.label === label ? e.dice : []));
const use = (unit: UnitId, abilityId: string, extra: Partial<Action> = {}): Action =>
  ({ t: 'ability', unit, abilityId, ...extra }) as Action;
const option = (s: GameState, id: UnitId, abilityId: string) =>
  engine.unitOptions(s, id).find((o) => o.t === 'ability' && o.abilityId === abilityId);

describe('Vengeful Forest Spirits (5dd6-a023-8cdb-5cb1), the Awakened Wyldwood', () => {
  /** The Wyldwood at (10,10); Seraphon units 2" and 8" from it, and a Sylvaneth unit 2" away. */
  function field(active: 0 | 1 = 0): GameState {
    const s = arena(
      {
        [WYLDWOOD]: [10, 10],
        [STARSEER]: [30, 10],
        [BASTILADON]: [50, 10],
        [DRYADS]: [30, 30],
        [BELTHANOS]: [60, 50],
      },
      'combat',
      active,
    );
    gapTo(s, STARSEER, WYLDWOOD, 2);
    gapTo(s, BASTILADON, WYLDWOOD, 8);
    placeUnit(scenario, s, DRYADS, 10, 30);
    return s;
  }
  const window = (s: GameState) => {
    const d = engine.decision(enterCombat(engine, s));
    if (d?.kind !== 'reaction') throw new Error('no window');
    return d;
  };

  it('is offered in the start-of-combat window, to the owner whichever turn it is, against the enemies within 3"', () => {
    for (const active of [0, 1] as const) {
      const d = window(field(active));
      expect(d).toMatchObject({ trigger: 'start:combat', player: 1 });
      const opt = d.options.find((o) => o.ability === 'vengefulForestSpirits');
      expect(opt).toMatchObject({ unit: WYLDWOOD, targets: [STARSEER] });
    }
  });

  it('is not offered with no enemy within 3", or outside the combat phase', () => {
    const s = field();
    gapTo(s, STARSEER, WYLDWOOD, 4);
    expect(engine.decision(enterCombat(engine, s))?.kind).not.toBe('reaction');
    const hero = field();
    hero.phase = 'hero';
    expect(engine.decision(hero)).not.toMatchObject({ kind: 'reaction' });
  });

  it('rolls a D3 for each target and inflicts that much mortal damage on a 2+', () => {
    const s = field();
    gapTo(s, BASTILADON, WYLDWOOD, 2.5);
    const w = window(s);
    expect(
      [...w.options.find((o) => o.ability === 'vengefulForestSpirits')!.targets!].sort(),
    ).toEqual([BASTILADON, STARSEER].sort());
    const start = enterCombat(engine, s);
    const r = applyUntil(engine, start, use(WYLDWOOD, VENGEFUL_FOREST_SPIRITS_ID), (x) => {
      const d = rolls(x.events, 'Vengeful Forest Spirits');
      return d.length === 2 && d[0]! >= 2 && d[1] === 1;
    });
    const dice = rolls(r.events, 'Vengeful Forest Spirits');
    const ids = [BASTILADON, STARSEER].sort();
    expect(r.state.units[ids[0]!]!.damage).toBe(dice[0]);
    expect(r.state.units[ids[1]!]!.damage).toBe(0);
    expect(r.state.units[DRYADS]!.damage).toBe(0);
  });

  it('once a turn for the army: not offered again, not even by a second piece', () => {
    const s = field();
    const r = engine.apply(enterCombat(engine, s), use(WYLDWOOD, VENGEFUL_FOREST_SPIRITS_ID));
    expect(r.state.players[1].usedOncePerTurn).toContain(VENGEFUL_FOREST_SPIRITS_ID);
    expect(() => engine.apply(r.state, use(WYLDWOOD, VENGEFUL_FOREST_SPIRITS_ID))).toThrow();
    expect(
      (engine.decision(r.state) as { options?: { ability?: string }[] }).options?.some(
        (o) => o.ability === 'vengefulForestSpirits',
      ),
    ).toBeFalsy();
  });

  it('is used by the NPC when it has a target', () => {
    const s = window(field()) && enterCombat(engine, field());
    expect(chooseAction(engine, s)).toMatchObject({
      t: 'ability',
      unit: WYLDWOOD,
      abilityId: VENGEFUL_FOREST_SPIRITS_ID,
    });
  });

  it('the terrain still never fights or moves (I74)', () => {
    const s = field();
    s.phase = 'movement';
    expect(engine.unitOptions(s, WYLDWOOD).filter((o) => o.t === 'move')).toEqual([]);
  });
});

describe('Fierce Guardians (bf4d-2061-b8d1-193), the Realmshaper Engine', () => {
  const hit = (s: GameState, attacker: UnitId, target: UnitId) => {
    const weapon = profileOf(scenario, s.units[attacker]!).weapons.find((w) => w.kind === 'melee')!;
    return attackModifiers(scenario, s, {
      attacker: s.units[attacker]!,
      target: s.units[target]!,
      weapon,
      mode: 'fight',
    }).filter((m) => m.source === 'Fierce Guardians');
  };
  function field(gap: number): GameState {
    const s = arena(
      { [ENGINE_T]: [10, 30], [WARRIORS]: [40, 50], [BASTILADON]: [40, 60], [DRYADS]: [40, 30] },
      'combat',
    );
    gapTo(s, DRYADS, ENGINE_T, gap);
    return s;
  }

  it('adds 1 to hit for a Saurus attacking an enemy within 9" of the terrain', () => {
    expect(hit(field(8), WARRIORS, DRYADS)).toEqual([
      { stat: 'hit', value: 1, source: 'Fierce Guardians' },
    ]);
  });

  it('not when the enemy is further than 9", the attacker is not Saurus or Kroxigor, or the shot is ranged', () => {
    expect(hit(field(10), WARRIORS, DRYADS)).toEqual([]);
    expect(hit(field(8), BASTILADON, DRYADS)).toEqual([]);
    const s = field(8);
    const weapon = profileOf(scenario, s.units[WARRIORS]!).weapons[0]!;
    expect(
      attackModifiers(scenario, s, {
        attacker: s.units[WARRIORS]!,
        target: s.units[DRYADS]!,
        weapon,
        mode: 'shoot',
      }).filter((m) => m.source === 'Fierce Guardians'),
    ).toEqual([]);
  });

  it('is lost with the terrain', () => {
    const s = field(8);
    s.units[ENGINE_T]!.status = 'destroyed';
    expect(hit(s, WARRIORS, DRYADS)).toEqual([]);
  });

  it('has the ability on the terrain warscroll', () => {
    expect(
      profileOf(scenario, startGame(engine, 1).units[ENGINE_T]!).abilities.map((a) => a.id),
    ).toEqual(expect.arrayContaining([FIERCE_GUARDIANS_ID, POWER_UNLEASHED_ID]));
  });
});

describe('Power Unleashed (aa75-204a-4256-8c68), the Realmshaper Engine', () => {
  const features = scenario.battlefield.terrain;
  const [cx, cy] = features[0]!.centre;

  /** A board feature `a`, the engine beside it, the Starseer 2" from the engine, enemies at `a`. */
  function field(): GameState {
    const s = arena(
      {
        [ENGINE_T]: [cx + 12, cy],
        [STARSEER]: [cx + 20, cy],
        [DRYADS]: [cx, cy],
        [DRYADS2]: [cx, cy],
        [SPITES]: [cx, cy],
        [BELTHANOS]: [cx, cy],
      },
      'hero',
    );
    gapTo(s, STARSEER, ENGINE_T, 2);
    // The enemies stand on the feature's edge, within 3" of it.
    for (const [i, id] of [DRYADS, DRYADS2, SPITES, BELTHANOS].entries()) {
      placeUnit(scenario, s, id, cx, cy + i * 3 - 4);
    }
    return s;
  }

  it('is offered in the hero phase when a friendly Seraphon Wizard is within 3" of the terrain', () => {
    const s = field();
    const o = option(s, ENGINE_T, POWER_UNLEASHED_ID);
    expect(o).toMatchObject({ maxTargets: 3 });
    expect(o?.t === 'ability' && o.targets.length).toBeGreaterThanOrEqual(1);
    gapTo(s, STARSEER, ENGINE_T, 4);
    expect(option(s, ENGINE_T, POWER_UNLEASHED_ID)).toBeUndefined();
  });

  it('is offered only in your own hero phase', () => {
    const s = field();
    s.phase = 'shooting';
    expect(option(s, ENGINE_T, POWER_UNLEASHED_ID)).toBeUndefined();
  });

  it('rolls a D3 for each of up to 3 targets, mortal damage on a 2+, once a turn', () => {
    const s = field();
    const o = option(s, ENGINE_T, POWER_UNLEASHED_ID);
    if (!o || o.t !== 'ability') throw new Error('not offered');
    const picks = o.targets.slice(0, 2);
    const r = applyUntil(engine, s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: picks }), (x) => {
      const d = rolls(x.events, 'Power Unleashed');
      return d.length === 2 && d[0]! >= 2 && d[1] === 1;
    });
    const dice = rolls(r.events, 'Power Unleashed');
    expect(r.state.units[picks[0]!]!.damage).toBe(dice[0]);
    expect(r.state.units[picks[1]!]!.damage).toBe(0);
    expect(option(r.state, ENGINE_T, POWER_UNLEASHED_ID)).toBeUndefined();
    expect(() =>
      engine.apply(r.state, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: picks })),
    ).toThrow();
  });

  it('refuses a 4th target, a repeated one, none, or targets not around one feature', () => {
    const s = field();
    const o = option(s, ENGINE_T, POWER_UNLEASHED_ID);
    if (!o || o.t !== 'ability') throw new Error('not offered');
    const all = [DRYADS, DRYADS2, SPITES, BELTHANOS];
    expect(() => engine.apply(s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: all }))).toThrow();
    expect(() =>
      engine.apply(s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [DRYADS, DRYADS] })),
    ).toThrow();
    expect(() => engine.apply(s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [] }))).toThrow();
    expect(() =>
      engine.apply(s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [WARRIORS] })),
    ).toThrow();
  });

  it('refuses two enemies near different features, though each is a legal target alone', () => {
    // Two board features, one enemy at each, the engine between them within 24" of both.
    let s: GameState | null = null;
    for (let i = 0; i < features.length && !s; i++) {
      for (let j = i + 1; j < features.length && !s; j++) {
        const [ax, ay] = features[i]!.centre;
        const [bx, by] = features[j]!.centre;
        if (Math.hypot(ax - bx, ay - by) > 30) continue;
        const t = arena(
          {
            [ENGINE_T]: [(ax + bx) / 2, (ay + by) / 2],
            [STARSEER]: [(ax + bx) / 2 + 12, (ay + by) / 2],
            [DRYADS]: [ax, ay],
            [DRYADS2]: [bx, by],
          },
          'hero',
        );
        gapTo(t, STARSEER, ENGINE_T, 2);
        const groups = powerGroups(scenario, t, t.units[ENGINE_T]!);
        const both = groups.some((g) => g.targets.includes(DRYADS) && g.targets.includes(DRYADS2));
        const each = [DRYADS, DRYADS2].every((id) => groups.some((g) => g.targets.includes(id)));
        if (each && !both && option(t, ENGINE_T, POWER_UNLEASHED_ID)) s = t;
      }
    }
    if (!s) throw new Error('no pair of features for the test');
    const one = engine.apply(s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [DRYADS] }));
    expect(rolls(one.events, 'Power Unleashed')).toHaveLength(1);
    expect(() =>
      engine.apply(s!, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [DRYADS, DRYADS2] })),
    ).toThrow(IllegalActionError);
  });

  describe('the enemy Awakened Wyldwood as the picked feature (it has Health)', () => {
    /** Finds a spot where the Wyldwood is the only feature with an enemy within 3". */
    function wood(): GameState {
      for (let x = 10; x < 60; x += 4) {
        for (let y = 8; y < 40; y += 4) {
          const s = arena(
            {
              [ENGINE_T]: [x + 10, y],
              [STARSEER]: [x + 20, y],
              [WYLDWOOD]: [x, y],
              [DRYADS]: [x, y + 12],
            },
            'hero',
          );
          gapTo(s, STARSEER, ENGINE_T, 2);
          const dryads = s.units[DRYADS]!;
          const d0 = unitDistance(scenario, dryads, s.units[WYLDWOOD]!);
          for (const m of dryads.models) m.y -= d0 - 2;
          const groups = powerGroups(scenario, s, s.units[ENGINE_T]!);
          if (groups.length === 1 && groups[0]!.feature === WYLDWOOD) return s;
        }
      }
      throw new Error('no spot for the test');
    }

    it('takes a D3 of mortal damage on top of the targets', () => {
      const s = wood();
      expect(profileOf(scenario, s.units[WYLDWOOD]!).health).toBeGreaterThan(0);
      const r = applyUntil(
        engine,
        s,
        use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [DRYADS] }),
        (x) => rolls(x.events, 'Power Unleashed (terrain)').length === 1,
      );
      const [terrainDie] = rolls(r.events, 'Power Unleashed (terrain)');
      expect(r.state.units[WYLDWOOD]!.damage).toBe(terrainDie);
      expect(r.state.units[ENGINE_T]!.damage).toBe(0);
    });

    it('destroys the Wyldwood when the damage is enough', () => {
      const s = wood();
      const health = profileOf(scenario, s.units[WYLDWOOD]!).health;
      s.units[WYLDWOOD]!.damage = health - 1;
      const r = engine.apply(s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [DRYADS] }));
      expect(r.state.units[WYLDWOOD]!.status).toBe('destroyed');
    });
  });

  it('does not touch the terrain: board terrain has no Health', () => {
    const s = field();
    const o = option(s, ENGINE_T, POWER_UNLEASHED_ID);
    if (!o || o.t !== 'ability') throw new Error('not offered');
    const r = engine.apply(s, use(ENGINE_T, POWER_UNLEASHED_ID, { targets: [o.targets[0]!] }));
    expect(r.state.units[ENGINE_T]!.damage).toBe(0);
  });

  it('is used by the NPC in its hero phase when a group exists', () => {
    const s = field();
    expect(chooseAction(engine, s)).toMatchObject({
      t: 'ability',
      unit: ENGINE_T,
      abilityId: POWER_UNLEASHED_ID,
    });
  });
});
