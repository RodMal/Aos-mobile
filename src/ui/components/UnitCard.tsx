/** Unit cards: a compact stat line and the full warscroll. */
import { aliveCount, type UnitState } from '../../engine/index.js';
import { diceText, type UnitProfile, type Weapon } from '../../data/profile.js';
import { displayKeyword } from '../../data/markup.js';
import { profileFor, scenario } from '../game/engine.js';
import { AbilityView } from './AbilityView.js';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function moveText(p: UnitProfile): string {
  if (p.moveDice) return `${diceText(p.moveDice)}"`;
  return p.move > 0 ? `${p.move}"` : '–';
}

export function StatLine({ unit }: { unit: UnitState }) {
  const p = profileFor(unit);
  const alive = aliveCount(unit);
  return (
    <div className="stats" data-testid="stat-line">
      <Stat label="Move" value={moveText(p)} />
      <Stat label="Health" value={String(p.health)} />
      <Stat label="Save" value={p.save >= 7 ? '–' : `${p.save}+`} />
      <Stat label="Control" value={String(p.control)} />
      {p.ward !== null && <Stat label="Ward" value={`${p.ward}+`} />}
      <Stat label="Models" value={`${alive}/${unit.models.length}`} />
      <Stat label="Damage" value={String(unit.damage)} />
    </div>
  );
}

function WeaponRows({ weapons, title }: { weapons: Weapon[]; title: string }) {
  if (weapons.length === 0) return null;
  const ranged = weapons[0]!.kind === 'ranged';
  return (
    <table className="weapons">
      <thead>
        <tr>
          <th className="w-name">{title}</th>
          {ranged && <th>Rng</th>}
          <th>Atk</th>
          <th>Hit</th>
          <th>Wnd</th>
          <th>Rnd</th>
          <th>Dmg</th>
        </tr>
      </thead>
      <tbody>
        {weapons.map((w) => (
          <tr key={w.id}>
            <td className="w-name">
              {w.name}
              {w.abilityText.length > 0 && (
                <span className="w-abilities">{w.abilityText.join(', ')}</span>
              )}
            </td>
            {ranged && <td>{w.range}"</td>}
            <td>{diceText(w.attacks)}</td>
            <td>{w.hit >= 7 ? '–' : `${w.hit}+`}</td>
            <td>{w.wound >= 7 ? '–' : `${w.wound}+`}</td>
            <td>{w.rend ? `-${w.rend}` : '–'}</td>
            <td>{diceText(w.damage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Everything printed on the warscroll, plus this unit's enhancements. */
export function FullCard({ unit }: { unit: UnitState }) {
  const p = profileFor(unit);
  const armyUnit = scenario.armies[unit.owner].units[unit.armyIndex];
  const enhancements = armyUnit?.enhancements ?? [];
  return (
    <div className="full-card" data-testid="full-card">
      <WeaponRows weapons={p.weapons.filter((w) => w.kind === 'ranged')} title="Ranged weapons" />
      <WeaponRows weapons={p.weapons.filter((w) => w.kind === 'melee')} title="Melee weapons" />
      {p.abilities.length > 0 && <h3 className="section-title">Abilities</h3>}
      {p.abilities.map((a) => (
        <AbilityView key={a.id} ability={a} />
      ))}
      {enhancements.length > 0 && <h3 className="section-title">Enhancements</h3>}
      {enhancements.map((e) => (
        <AbilityView key={e.ability.id} ability={e.ability} />
      ))}
      <p className="keywords unit-keywords">{p.keywords.map(displayKeyword).join(' · ')}</p>
      <p className="muted small">
        {p.points} points{p.reinforced ? ' · reinforced' : ''}
        {armyUnit?.general ? ' · general' : ''}
      </p>
    </div>
  );
}
