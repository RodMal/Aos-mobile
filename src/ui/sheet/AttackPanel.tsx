/** Shooting and fighting: which weapon hits which target, All-out Attack, then roll. */
import { rollAttack } from '../game/actions.js';
import { useGameState, useHuman } from '../game/hooks.js';
import { planDamage, setWeaponTarget, toAllocations } from '../game/attackPlan.js';
import { useUi } from '../game/uiStore.js';

export function AttackPanel() {
  const attack = useUi((s) => s.attack);
  const setAttack = useUi((s) => s.setAttack);
  const state = useGameState();
  const human = useHuman();
  if (!attack) return null;
  const unit = state.units[attack.unit];
  if (!unit) return null;
  const cp = state.players[human].cp;
  const allocations = toAllocations(attack.plan);
  const total = [...planDamage(attack.plan, attack.options).values()].reduce((a, b) => a + b, 0);
  const name = (id: string) => state.units[id]?.name ?? id;
  return (
    <div className="panel attack-panel" data-testid="attack-panel">
      <header>
        <h2 className="panel-title">
          {attack.mode === 'shoot' ? 'Shoot with' : 'Fight with'} {unit.name}
        </h2>
        <p className="panel-hint">
          Each weapon is aimed at its best target. Tap a highlighted enemy to switch every weapon
          that can reach it.
        </p>
      </header>
      <ul className="weapon-list">
        {attack.options.map((o) => {
          const chosen = attack.plan[o.weaponId] ?? '';
          const target = o.targets.find((t) => t.unit === chosen);
          return (
            <li key={o.weaponId} className="weapon-row">
              <div className="weapon-name">
                {o.weaponName}
                <span className="muted small">
                  {target
                    ? ` · ${target.modelsInRange} in range · ≈${target.expectedDamage.toFixed(1)} dmg`
                    : ''}
                </span>
              </div>
              <select
                className="select"
                aria-label={`Target for ${o.weaponName}`}
                value={chosen}
                disabled={o.targets.length === 0}
                onChange={(e) =>
                  setAttack({
                    ...attack,
                    plan: setWeaponTarget(attack.plan, o.weaponId, e.target.value || null),
                  })
                }
              >
                <option value="">
                  {o.targets.length === 0 ? 'No target in range' : 'Not used'}
                </option>
                {o.targets.map((t) => (
                  <option key={t.unit} value={t.unit}>
                    {name(t.unit)} (≈{t.expectedDamage.toFixed(1)})
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <label className={`toggle ${cp < 1 ? 'disabled' : ''}`}>
        <input
          type="checkbox"
          checked={attack.allOutAttack}
          disabled={cp < 1}
          onChange={(e) => setAttack({ ...attack, allOutAttack: e.target.checked })}
        />
        <span>All-out Attack (1 CP, +1 to hit) · you have {cp} CP</span>
      </label>
      <div className="confirm-row">
        {attack.mode === 'shoot' && (
          <button className="btn" onClick={() => setAttack(null)}>
            Cancel
          </button>
        )}
        <button
          className="btn primary grow"
          disabled={attack.mode === 'shoot' && allocations.length === 0}
          onClick={rollAttack}
          data-testid="roll-attacks"
        >
          Roll{allocations.length > 0 ? ` · ≈${total.toFixed(1)} dmg` : ''}
        </button>
      </div>
    </div>
  );
}
