/** Wording that follows the input device: "Tap" on a touch screen, "Click" with a mouse. */
export function finePointer(): boolean {
  try {
    return window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

export const tapWord = (): string => (finePointer() ? 'Click' : 'Tap');
