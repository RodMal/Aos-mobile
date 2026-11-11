/**
 * Keyboard basics for a physical keyboard: Escape backs out of the topmost thing (a dialog, the
 * unit chooser, a drawer, an ability or attack panel, the warscroll, the unit card) and Enter
 * presses the sheet's primary button when it is a safe one (confirm a placement, confirm an
 * ability, roll attacks). Phases are never ended from the keyboard.
 */
import { useEffect } from 'react';
import { useUi } from '../game/uiStore.js';

/** Backs out of the topmost layer; returns false when there was nothing to close. */
export function closeTopmost(): boolean {
  const ui = useUi.getState();
  if (document.querySelector('[data-testid="confirm"]')) {
    ui.closeConfirm();
    return true;
  }
  // Other modals (priority, reaction, result) need a real answer.
  if (document.querySelector('[aria-modal="true"]')) return false;
  if (ui.chooser) {
    ui.setChooser(null);
    return true;
  }
  if (ui.drawer) {
    ui.openDrawer(null);
    return true;
  }
  if (ui.abilityPick) {
    ui.setAbilityPick(null);
    return true;
  }
  if (ui.attack?.mode === 'shoot') {
    ui.setAttack(null);
    return true;
  }
  if (ui.draft) return false;
  if (ui.sheetExpanded) {
    ui.setSheetExpanded(false);
    return true;
  }
  if (ui.selected) {
    ui.select(null);
    return true;
  }
  return false;
}

const PRIMARY = [
  '[data-testid="place-confirm"]',
  '[data-testid="ability-confirm"]',
  '[data-testid="roll-attacks"]',
].join(',');

export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      if (e.key === 'Escape') {
        if (closeTopmost()) e.preventDefault();
        return;
      }
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      // A focused control handles Enter itself; leave text fields alone too.
      if (target && /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const ui = useUi.getState();
      if (ui.confirm || ui.drawer || ui.chooser || document.querySelector('[aria-modal="true"]'))
        return;
      const button = document.querySelector<HTMLButtonElement>(PRIMARY);
      if (button && !button.disabled) {
        e.preventDefault();
        button.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
