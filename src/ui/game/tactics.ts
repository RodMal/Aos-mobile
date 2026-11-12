/** What the battle tactics tracker shows: each card in play, its three tiers and where a player stands. */
import type { BattleTacticCard } from '../../data/catalog.js';
import type { GameState, PlayerId, TacticTier } from '../../engine/index.js';

export const TIERS = ['affray', 'strike', 'domination'] as const;
export type TierName = (typeof TIERS)[number];

export interface TierView {
  tier: TierName;
  /** "Affray", "Strike" or "Domination". */
  label: string;
  /** The tactic's own name, e.g. "Search Every Inch". */
  name: string;
  /** The printed condition, without the name. */
  condition: string;
  status: 'done' | 'next' | 'later';
}

export interface CardView {
  id: string;
  name: string;
  /** The card's own rule (e.g. picking the fugitive), when it has one. */
  cardRule: string | null;
  tiers: TierView[];
  completed: number;
}

const LABEL: Record<TierName, string> = {
  affray: 'Affray',
  strike: 'Strike',
  domination: 'Domination',
};

function splitSection(text: string): { name: string; condition: string } {
  const i = text.indexOf(':');
  if (i <= 0) return { name: '', condition: text.trim() };
  return { name: text.slice(0, i).trim(), condition: text.slice(i + 1).trim() };
}

/** The tracker's rows for one player's cards. */
export function tacticCardsView(
  cards: readonly BattleTacticCard[],
  state: GameState,
  player: PlayerId,
): CardView[] {
  const progress = state.players[player].tacticProgress ?? {};
  return cards.map((card) => {
    const at: TacticTier = progress[card.id] ?? 'affray';
    const atIndex = at === 'completed' ? TIERS.length : TIERS.indexOf(at);
    const tiers = TIERS.map((tier, i): TierView => {
      const section = card.sections.find((s) => s.name.toLowerCase() === tier);
      const { name, condition } = splitSection(section?.text ?? '');
      return {
        tier,
        label: LABEL[tier],
        name: name || LABEL[tier],
        condition,
        status: i < atIndex ? 'done' : i === atIndex ? 'next' : 'later',
      };
    });
    const rule = card.sections.find((s) => s.name.toLowerCase() === 'card')?.text.trim() ?? '';
    return { id: card.id, name: card.name, cardRule: rule || null, tiers, completed: atIndex };
  });
}
