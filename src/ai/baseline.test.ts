import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, unitCentre, type GameState } from '../engine/index.js';
import { editable, keepOnly, passTo, placeUnit, startGame } from '../engine/test-helpers.js';
import { chooseAction, isRanged } from './baseline.js';
import { moveTowards } from './placement.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

describe('baseline NPC', () => {
  it('plays a whole game with legal actions, deterministically', () => {
    const play = (): { state: GameState; kinds: Set<string> } => {
      let s = startGame(engine, 21);
      const kinds = new Set<string>();
      for (let i = 0; i < 5000 && engine.decision(s); i++) {
        const a = chooseAction(engine, s);
        kinds.add(a.t);
        s = engine.apply(s, a).state;
      }
      return { state: s, kinds };
    };
    const first = play();
    expect(first.state.status).toBe('ended');
    for (const t of ['move', 'place', 'charge', 'fight', 'targets', 'choose']) {
      expect(first.kinds.has(t), t).toBe(true);
    }
    expect(play().state).toEqual(first.state);
  });

  it('does not consume the RNG when choosing', () => {
    const s = startGame(engine, 5);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    chooseAction(engine, s);
    expect(s).toEqual(copy);
  });

  it('takes the first turn unless behind on VP', () => {
    let s = startGame(engine, 2);
    while (engine.decision(s)?.kind !== 'priority')
      s = engine.apply(s, engine.defaultAction(s)).state;
    const d = engine.decision(s)!;
    const ahead = editable(s);
    ahead.players[d.player].vp = 10;
    expect(chooseAction(engine, ahead)).toEqual({ t: 'choose', value: 'first' });
    const behind = editable(s);
    behind.players[d.player === 0 ? 1 : 0].vp = 10;
    expect(chooseAction(engine, behind)).toEqual({ t: 'choose', value: 'second' });
  });

  it('shoots with each weapon at the target with the best expected damage', () => {
    const s = editable(startGame(engine, 1));
    keepOnly(s, ['0:2', '1:7', '1:1']);
    placeUnit(scenario, s, '0:2', 20, 22);
    placeUnit(scenario, s, '1:7', 33, 22, 270);
    placeUnit(scenario, s, '1:1', 20, 33);
    const shooting = passTo(engine, s, 'shooting');
    const a = chooseAction(engine, shooting);
    if (a.t !== 'shoot') throw new Error(`expected a shot, got ${a.t}`);
    const best = engine
      .targetOptions(shooting, '0:2', 'shoot')[0]!
      .targets.reduce((x, y) => (y.expectedDamage > x.expectedDamage ? y : x));
    expect(a.allocations[0]!.target).toBe(best.unit);
  });

  it('knows ranged units from melee units', () => {
    const s = startGame(engine, 1);
    expect(isRanged(engine, s.units['1:7']!)).toBe(true); // Skinks
    expect(isRanged(engine, s.units['0:6']!)).toBe(false); // Dryads
  });
});

describe('placement builders', () => {
  it('moveTowards returns a legal placement that gets closer, or null', () => {
    const s = passTo(engine, startGame(engine, 1), 'movement');
    const declared = engine.apply(s, { t: 'move', unit: '0:6', kind: 'normal' }).state;
    const target = { x: 30, y: 22 };
    const p = moveTowards(engine, declared, '0:6', target)!;
    expect(engine.checkPlacement(declared, p)).toEqual([]);
    const before = unitCentre(s.units['0:6']!);
    const after = engine.apply(declared, { t: 'place', placement: p }).state;
    const now = unitCentre(after.units['0:6']!);
    expect(Math.hypot(now.x - target.x, now.y - target.y)).toBeLessThan(
      Math.hypot(before.x - target.x, before.y - target.y),
    );
    expect(moveTowards(engine, s, '0:6', target)).toBeNull(); // no place decision
  });
});
