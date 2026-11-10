import { describe, expect, it } from 'vitest';
import { eventLine, objectiveLabel, toastLine, type LogContext } from './eventText.js';

const ctx: LogContext = {
  unitName: (id) => ({ a: 'Dryads', b: 'Saurus Warriors', k: 'Belthanos' })[id] ?? id,
  playerName: (p) => (p === 0 ? 'Sylvaneth' : 'Seraphon'),
  weaponName: (_a, w) => (w === 'w1' ? 'Kurnoth Scythe' : w),
  objectiveName: objectiveLabel,
};

describe('eventLine', () => {
  it('describes moves with the distance in inches', () => {
    expect(
      eventLine({ t: 'moved', unit: 'a', kind: 'normal', dice: [], distance: 5.234 }, ctx)?.text,
    ).toBe('Dryads moved 5.2"');
    expect(
      eventLine({ t: 'moved', unit: 'a', kind: 'run', dice: [4], distance: 9 }, ctx)?.text,
    ).toBe('Dryads ran 9" (rolled 4)');
  });

  it('summarises attacks and keeps the dice for the detail view', () => {
    const line = eventLine(
      {
        t: 'attacks',
        attacker: 'k',
        target: 'b',
        weapon: 'w1',
        mode: 'fight',
        attacks: 12,
        hits: 8,
        crits: 1,
        wounds: 5,
        unsaved: 3,
        mortal: 0,
        damage: 6,
        warded: 0,
        dice: { hit: [1, 6], wound: [4], save: [2, 5], ward: [] },
      },
      ctx,
    )!;
    expect(line.text).toBe(
      'Kurnoth Scythe → Saurus Warriors: 12 attacks, 8 hits, 5 wounds, 2 saved, 6 damage',
    );
    expect(line.detail).toContain('Hit rolls: 1 6');
    expect(line.detail?.some((d) => d.startsWith('Ward'))).toBe(false);
  });

  it('describes charges, damage, priority, scoring and the end', () => {
    expect(eventLine({ t: 'chargeRoll', unit: 'a', dice: [3, 4], success: true }, ctx)?.text).toBe(
      'Dryads charge roll 3+4 = 7: in range',
    );
    expect(
      eventLine(
        { t: 'damage', unit: 'b', amount: 4, slain: 2, destroyed: false, source: 'attacks' },
        ctx,
      )?.text,
    ).toBe('Saurus Warriors lost 2 models (attacks)');
    expect(eventLine({ t: 'priority', rolls: [5, 2], winner: 0 }, ctx)?.text).toContain(
      'Sylvaneth choose',
    );
    expect(eventLine({ t: 'score', player: 1, vp: 2, reason: 'objectives' }, ctx)?.text).toBe(
      'Seraphon score 2 VP: objectives',
    );
    expect(eventLine({ t: 'gameEnd', winner: 'draw', vp: [10, 10] }, ctx)?.text).toBe(
      'Game over: a draw, 10–10',
    );
    expect(
      eventLine({ t: 'objective', objective: 'golden-lions-1', controller: 0 }, ctx)?.text,
    ).toBe('Sylvaneth control Golden Lions 1');
  });

  it('picks the last major line for a toast', () => {
    const a = eventLine({ t: 'moved', unit: 'a', kind: 'normal', dice: [], distance: 3 }, ctx)!;
    const b = eventLine({ t: 'phaseStart', phase: 'shooting', player: 0 }, ctx)!;
    expect(toastLine([a, b])).toBe(a);
    expect(toastLine([b])).toBe(b);
    expect(toastLine([])).toBeNull();
  });
});
