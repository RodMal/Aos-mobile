import type { Ability } from '../../data/schema/index.js';
import { displayKeyword } from '../../data/markup.js';
import { Markup } from './Markup.js';

/** One ability with its full printed text. */
export function AbilityView({ ability }: { ability: Ability }) {
  const meta = [
    ability.cost ? `${ability.cost} CP` : null,
    ability.castingValue ? `Casting value ${ability.castingValue}` : null,
    ability.chantingValue ? `Chanting value ${ability.chantingValue}` : null,
  ].filter(Boolean);
  return (
    <article className="ability" data-ability={ability.id}>
      <header>
        <h4>{ability.name}</h4>
        {ability.timing && <span className="timing">{ability.timing}</span>}
      </header>
      {meta.length > 0 && <p className="ability-meta">{meta.join(' · ')}</p>}
      {ability.declare && (
        <p>
          <span className="ability-tag">Declare</span> <Markup text={ability.declare} />
        </p>
      )}
      <p>
        {ability.declare && <span className="ability-tag">Effect</span>}{' '}
        <Markup text={ability.effect} />
      </p>
      {ability.keywords.length > 0 && (
        <p className="keywords">{ability.keywords.map(displayKeyword).join(', ')}</p>
      )}
    </article>
  );
}
