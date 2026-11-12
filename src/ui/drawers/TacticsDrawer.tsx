/** Battle tactics tracker: each card in play for both players, its tiers, and the next condition. */
import { Markup } from '../components/Markup.js';
import { playerName, scenario } from '../game/engine.js';
import { useGameState, useHuman } from '../game/hooks.js';
import { tacticCardsView, type CardView } from '../game/tactics.js';
import type { GameState, PlayerId } from '../../engine/index.js';
import { Drawer } from './Drawer.js';

function cardNote(state: GameState, player: PlayerId, card: CardView): string | null {
  const p = state.players[player];
  if (card.name === 'Burning for Vengeance') {
    const id = p.fugitiveUnit;
    return id ? `Fugitive: ${state.units[id]?.name ?? id}` : 'Fugitive: not picked yet';
  }
  return null;
}

function Card({ card, note }: { card: CardView; note: string | null }) {
  const next = card.tiers.find((t) => t.status === 'next');
  return (
    <li className="tactic-card" data-testid="tactic-card">
      <div className="tactic-head">
        <strong>{card.name}</strong>
        <span className="tactic-count">{card.completed}/3</span>
      </div>
      {note && <div className="tactic-note">{note}</div>}
      <ol className="tactic-tiers">
        {card.tiers.map((t) => (
          <li
            key={t.tier}
            className={`tactic-tier ${t.status}`}
            data-testid={`tier-${t.tier}`}
            data-status={t.status}
          >
            <span className="tier-mark" aria-hidden="true">
              {t.status === 'done' ? '✓' : t.status === 'next' ? '▸' : '·'}
            </span>
            <span className="tier-label">{t.label}</span>
            <span className="tier-name">{t.name}</span>
            <span className="sr-only">
              {t.status === 'done' ? ' completed' : t.status === 'next' ? ' next' : ''}
            </span>
          </li>
        ))}
      </ol>
      {next ? (
        <p className="tactic-condition" data-testid="tactic-next">
          <Markup text={next.condition} />
        </p>
      ) : (
        <p className="tactic-condition done">All three tiers completed.</p>
      )}
    </li>
  );
}

export function TacticsPanel({ testId = 'tactics-panel' }: { testId?: string }) {
  const state = useGameState();
  const human = useHuman();
  const enemy: PlayerId = human === 0 ? 1 : 0;
  return (
    <div className="tactics" data-testid={testId}>
      {[human, enemy].map((p) => (
        <section key={p} className={`tactics-side ${p === human ? 'friendly' : 'enemy'}`}>
          <h3>
            {p === human ? 'You' : playerName(p)} · {state.players[p].vp} VP
          </h3>
          <ul className="tactic-list">
            {tacticCardsView(scenario.armies[p].tacticCards, state, p).map((c) => (
              <Card key={c.id} card={c} note={cardNote(state, p, c)} />
            ))}
          </ul>
        </section>
      ))}
      <p className="tactics-foot">
        Each tier is worth 5 VP, checked at the end of your turn; both cards can advance in the same
        turn. No tactics are scored on the second turn of a double turn unless you were behind by 11
        or more VP.
      </p>
    </div>
  );
}

export function TacticsDrawer() {
  return (
    <Drawer title="Battle tactics" testId="tactics">
      <TacticsPanel />
    </Drawer>
  );
}
