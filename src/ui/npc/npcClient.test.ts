import { describe, expect, it } from 'vitest';
import { npcChoice } from './npcClient.js';

describe('npcChoice', () => {
  it('is the champion in normal play whatever npc= says', () => {
    expect(npcChoice('')).toBe('champion');
    expect(npcChoice('?npc=baseline')).toBe('champion');
  });
  it('is the baseline on the e2e page unless npc=champion', () => {
    expect(npcChoice('?e2e')).toBe('baseline');
    expect(npcChoice('?e2e&npc=champion')).toBe('champion');
  });
});
