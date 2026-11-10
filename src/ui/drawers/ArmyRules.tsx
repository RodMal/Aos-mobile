/** Army-level rules: battle traits, formation, lores, enhancements and battle tactic cards. */
import { useState, type ReactNode } from 'react';
import type { PlayerId } from '../../engine/index.js';
import { playerName, scenario } from '../game/engine.js';
import { useHuman } from '../game/hooks.js';
import { AbilityView } from '../components/AbilityView.js';
import { Markup } from '../components/Markup.js';
import { Drawer } from './Drawer.js';

function Section({
  title,
  children,
  open,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="rules-section" open={open}>
      <summary>{title}</summary>
      <div className="rules-body">{children}</div>
    </details>
  );
}

function ArmyPanel({ player }: { player: PlayerId }) {
  const army = scenario.armies[player];
  const lores = [army.spellLore, army.prayerLore, army.manifestationLore].filter((l) => l !== null);
  const enhanced = army.units.filter((u) => u.enhancements.length > 0);
  return (
    <div className="army-panel">
      <p className="muted small">
        {army.list.title} · {army.points} points{army.list.placeholder ? ' · placeholder list' : ''}
      </p>
      <Section title="Battle traits" open>
        {army.battleTraits.map((a) => (
          <AbilityView key={a.id} ability={a} />
        ))}
      </Section>
      <Section title={`Formation: ${army.formation.name}`}>
        {army.formation.abilities.map((a) => (
          <AbilityView key={a.id} ability={a} />
        ))}
      </Section>
      {lores.map((lore) => (
        <Section key={lore.id} title={lore.name}>
          {lore.abilities.map((a) => (
            <AbilityView key={a.id} ability={a} />
          ))}
        </Section>
      ))}
      {enhanced.length > 0 && (
        <Section title="Enhancements">
          {enhanced.flatMap((u) =>
            u.enhancements.map((e) => (
              <div key={`${u.index}-${e.ability.id}`}>
                <p className="muted small">
                  {u.profile.name} · {e.group}
                </p>
                <AbilityView ability={e.ability} />
              </div>
            )),
          )}
        </Section>
      )}
      <Section title="Battle tactic cards">
        {army.tacticCards.map((card) => (
          <article key={card.id} className="ability">
            <header>
              <h4>{card.name}</h4>
            </header>
            {card.sections.map((s, i) => (
              <p key={i}>
                <span className="ability-tag">{s.name}</span> <Markup text={s.text} />
              </p>
            ))}
          </article>
        ))}
      </Section>
    </div>
  );
}

export function ArmyRules() {
  const human = useHuman();
  const [player, setPlayer] = useState<PlayerId>(human);
  return (
    <Drawer title="Army rules" testId="army-rules">
      <div className="tabs" role="tablist">
        {([human, human === 0 ? 1 : 0] as PlayerId[]).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={p === player}
            className={`tab ${p === player ? 'on' : ''} ${p === human ? 'friendly' : 'enemy'}`}
            onClick={() => setPlayer(p)}
          >
            {playerName(p)}
          </button>
        ))}
      </div>
      <ArmyPanel player={player} />
    </Drawer>
  );
}
