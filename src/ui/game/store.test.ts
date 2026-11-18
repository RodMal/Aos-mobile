import { afterEach, describe, expect, it, vi } from 'vitest';
import { RULES_VERSION } from './session.js';
import { SAVE_KEY, initialSession } from './store.js';

const bare = { seed: null, side: null, fast: true, fresh: false } as const;

function stubStorage(value: unknown): void {
  const data = new Map<string, string>();
  if (value !== undefined) data.set(SAVE_KEY, JSON.stringify(value));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('initialSession and saved game versions', () => {
  it('a save without a version is outdated: notice, no Continue', () => {
    stubStorage({ v: 1, seed: 5, humanPlayer: 0, actions: [] });
    const s = initialSession(bare);
    expect(s).toMatchObject({ started: false, canContinue: false, outdated: true });
  });

  it('a save of the current version that replays can be continued', () => {
    stubStorage({ v: 1, rules: RULES_VERSION, seed: 5, humanPlayer: 0, actions: [] });
    const s = initialSession(bare);
    expect(s).toMatchObject({ started: false, canContinue: true });
    expect(s.outdated).toBeFalsy();
  });

  it('a save of the current version whose replay throws gets the notice', () => {
    stubStorage({
      v: 1,
      rules: RULES_VERSION,
      seed: 5,
      humanPlayer: 0,
      actions: [{ t: 'nonsense' }],
    });
    expect(initialSession(bare)).toMatchObject({
      started: false,
      canContinue: false,
      outdated: true,
    });
  });

  it('no save: no notice', () => {
    stubStorage(undefined);
    expect(initialSession(bare).outdated).toBeFalsy();
  });
});
