/** A few line icons drawn inline (no icon font, no dependency). */
const PATHS: Record<string, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  roster: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  log: 'M6 4h9l3 3v13H6zM9 10h6M9 14h6M9 18h4',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6L6 18',
  rotl: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
  rotr: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  face: 'M12 3l7 18-7-4-7 4z',
  engage: 'M4 12h9M10 8l4 4-4 4M17 5v14M20 8v8',
  narrow: 'M9 6v12M15 6v12M4 12h3M17 12h3',
  wide: 'M4 6v12M20 6v12M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3',
  adjust: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  reset: 'M4 4v6h6M20 20v-6h-6M5 15a8 8 0 0 0 14 2M19 9A8 8 0 0 0 5 7',
  book: 'M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h10',
  chevron: 'M6 9l6 6 6-6',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
