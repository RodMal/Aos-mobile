/** The bottom sheet: whatever the player needs to decide now, in the thumb zone. */
import { useLayoutEffect, useRef } from 'react';
import { useHumanDecision } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { AbilityPanel } from './AbilityPanel.js';
import { AttackPanel } from './AttackPanel.js';
import { DecisionPanel } from './DecisionPanel.js';
import { PlacePanel } from './PlacePanel.js';
import { Rail } from './Rail.js';
import { UnitPanel } from './UnitPanel.js';

export function Sheet() {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const setSheetHeight = useUi((s) => s.setSheetHeight);
  const draft = useUi((s) => s.draft);
  const attack = useUi((s) => s.attack);
  const abilityPick = useUi((s) => s.abilityPick);
  const selected = useUi((s) => s.selected);
  const expanded = useUi((s) => s.sheetExpanded);
  const decision = useHumanDecision();

  useLayoutEffect(() => {
    const el = ref.current;
    const body = bodyRef.current;
    if (!el || !body) return;
    const update = () => {
      if (getComputedStyle(el).position !== 'absolute') {
        setSheetHeight(0);
        return;
      }
      // The board keeps clear of the panel itself, not of the buttons that float above it. Only the
      // collapsed height counts for the board: an expanded card is a temporary overlay.
      if (!useUi.getState().sheetExpanded) setSheetHeight(body.getBoundingClientRect().height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(body);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [setSheetHeight]);

  let content;
  if (draft && decision?.kind === 'place') content = <PlacePanel />;
  else if (attack) content = <AttackPanel />;
  else if (abilityPick) content = <AbilityPanel />;
  else if (selected) content = <UnitPanel unitId={selected} />;
  else content = <DecisionPanel />;

  return (
    <div ref={ref} className={`sheet ${expanded ? 'expanded' : ''}`} data-testid="sheet">
      <Rail />
      <div ref={bodyRef} className="sheet-body">
        {content}
      </div>
    </div>
  );
}
