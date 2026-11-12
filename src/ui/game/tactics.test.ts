import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario } from '../../engine/index.js';
import { tacticCardsView } from './tactics.js';
import { startGame } from '../../engine/test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

describe('tacticCardsView', () => {
  it('shows each card with its three tiers, the next tier and its printed condition', () => {
    const state = structuredClone(startGame(engine, 1));
    const cards = scenario.armies[0].tacticCards;
    expect(cards.length).toBe(2);
    const first = cards[0]!;
    state.players[0].tacticProgress = { [first.id]: 'strike' };
    const view = tacticCardsView(cards, state, 0);
    expect(view[0]!.tiers.map((t) => t.status)).toEqual(['done', 'next', 'later']);
    expect(view[0]!.completed).toBe(1);
    expect(view[0]!.tiers.map((t) => t.label)).toEqual(['Affray', 'Strike', 'Domination']);
    expect(view[0]!.tiers[1]!.name.length).toBeGreaterThan(0);
    expect(view[0]!.tiers[1]!.condition).toMatch(/^You complete this battle tactic/);
    expect(view[1]!.tiers[0]!.status).toBe('next');
  });

  it('marks every tier done for a completed card', () => {
    const state = structuredClone(startGame(engine, 1));
    const card = scenario.armies[1].tacticCards[0]!;
    state.players[1].tacticProgress = { [card.id]: 'completed' };
    const view = tacticCardsView([card], state, 1);
    expect(view[0]!.tiers.every((t) => t.status === 'done')).toBe(true);
    expect(view[0]!.completed).toBe(3);
  });
});
