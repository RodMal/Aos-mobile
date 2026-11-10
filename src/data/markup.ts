// Ported from RodMal/aos-guru src/lib/bsdata-markup.ts @4ba2dc6 (same owner).
// Pure and browser-safe: no I/O, no `node:` imports, no React.
//
// BSData inline markup: `**bold**` and `^^keyword^^` appear alone, combined and malformed in
// stored strings, and a `***` run toggles bold and italic together (the third `*` is not
// literal). Single-`*` italics are flagged on segments (`italic: true`) but never reach the
// plain-text forms (`stripBsdataMarkup`, `toPlain`).

/**
 * Bold and keyword marker tokens: `**`, `^^`, and a `***` run (not part of a longer run).
 * The tokenizer also reads single `*` italics (see {@link tokenizeMarkup}); they are not
 * listed here because a lone `*` is only markup when it flanks a word.
 */
export const MARKUP_TOKEN = /\*{3}(?!\*)|\*\*|\^\^/g;

/** All candidate tokens, longest first. */
const ANY_TOKEN = /\*{3}(?!\*)|\*\*|\^\^|\*/g;
/** A single `*` opens italics only before a word character or an opening quote/bracket. */
const ITALIC_OPEN_NEXT = /[\p{L}\p{N}'"\u2018\u201C(]/u;
/** A single `*` closes italics only after a non-space character that is not a marker. */
const ITALIC_CLOSE_PREV = /[^\s*^]/u;
/**
 * A letter or digit. A single `*` with one on both sides (`2*3`, `D3*2`) is arithmetic, never
 * italics: an opener must not follow one and a closer must not precede one.
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;
/**
 * A literal `*` touching a word on one side only, removed only by the malformed-markup safety
 * net. A `*` between two word characters (`2*3`) is arithmetic and stays.
 */
const GLUED_STAR =
  /(?<![\p{L}\p{N}])\*(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}.,:;!?)'\u2019])\*(?![\p{L}\p{N}])/gu;

/**
 * A styled run of text. `italic` is optional for backward compatibility: it is present (and
 * `true`) only on italic runs and absent otherwise, so plain and bold/keyword segments keep
 * their original `{ text, keyword, bold }` shape.
 */
export type MarkupSegment = { text: string; keyword: boolean; bold: boolean; italic?: boolean };

/** Options for {@link parseBsdataMarkup}. */
export type ParseMarkupOptions = {
  /**
   * Keep line breaks: a whitespace run containing a newline becomes one `\n` and any other
   * run one space (default `false`: every run becomes one space).
   */
  keepLineBreaks?: boolean;
};

/** Build a segment, adding `italic: true` only for italic runs. */
function makeSegment(
  text: string,
  keyword: boolean,
  bold: boolean,
  italic: boolean,
): MarkupSegment {
  return italic ? { text, keyword, bold, italic: true } : { text, keyword, bold };
}

/** True when two segments carry the same styles (a missing `italic` equals `false`). */
function sameStyle(
  a: MarkupSegment,
  keyword: boolean,
  bold: boolean,
  italic: boolean | undefined,
): boolean {
  return a.keyword === keyword && a.bold === bold && (a.italic === true) === (italic === true);
}

type Token = { at: number; len: number; bold: boolean; keyword: boolean; italic: boolean };

/**
 * Tokenize a stored string into styled segments, keeping whitespace verbatim.
 *
 * - `**` toggles bold and `^^` toggles keyword, scanned left to right; each style toggles on
 *   its own token.
 * - BSData also uses markdown italics: a `***` run toggles bold and italic together, and a
 *   single `*` toggles italic when it flanks a word (opener before a letter, digit or
 *   opening quote and not after a letter or digit; closer after a non-space and not before
 *   a letter or digit). Any other `*` or `^` is literal text, so `5*`, `a * b`, `2*3` and
 *   `D3*2` are unchanged. Text inside italics gets `italic: true` (combined freely with bold
 *   and keyword); other segments have no `italic` key.
 * - An italic left open at the end has no closer; its marker is removed anyway (a `*`
 *   before a word is never literal in BSData) and the text after it is not italic.
 * - Safety net: if bold or keyword is still open at the end (an odd token count), all
 *   styling (italic included) is discarded and the string comes back as one plain segment
 *   with the tokens removed, so malformed markup never bleeds into the rest of the text. In
 *   that case a leftover `*` glued to a word on one side (`**Foo*`) is removed too; a
 *   free-standing `*` and an arithmetic `2*3` stay.
 *
 * Adjacent segments with the same style are merged; empty segments are dropped.
 */
export function tokenizeMarkup(input: string): MarkupSegment[] {
  const tokens: Token[] = [];
  let italic = false;
  let lastItalic = -1;
  // A fresh RegExp per call keeps the exported constants free of `lastIndex` state.
  const re = new RegExp(ANY_TOKEN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const tok = m[0];
    if (tok === '*') {
      const prev = input[m.index - 1] ?? ' ';
      const next = input[m.index + 1] ?? ' ';
      const ok = italic
        ? ITALIC_CLOSE_PREV.test(prev) && !WORD_CHAR.test(next)
        : ITALIC_OPEN_NEXT.test(next) && !WORD_CHAR.test(prev);
      if (!ok) continue; // literal star
    }
    const t: Token = {
      at: m.index,
      len: tok.length,
      bold: tok.length >= 2 && tok !== '^^',
      keyword: tok === '^^',
      italic: tok.length !== 2,
    };
    if (t.italic) {
      italic = !italic;
      lastItalic = tokens.length;
    }
    tokens.push(t);
  }
  // An italic still open at the end has no closer: its marker is dropped (a `*` before a
  // word is never literal in BSData) and the italic half of a `***` run is ignored.
  if (italic) {
    const open = tokens[lastItalic];
    if (open) open.italic = false;
  }

  const raw: MarkupSegment[] = [];
  let keyword = false;
  let bold = false;
  let inItalic = false;
  const push = (text: string): void => {
    if (!text) return;
    const last = raw[raw.length - 1];
    if (last && sameStyle(last, keyword, bold, inItalic)) last.text += text;
    else raw.push(makeSegment(text, keyword, bold, inItalic));
  };
  let pos = 0;
  for (const t of tokens) {
    push(input.slice(pos, t.at));
    if (t.bold) bold = !bold;
    if (t.keyword) keyword = !keyword;
    if (t.italic) inItalic = !inItalic;
    pos = t.at + t.len;
  }
  push(input.slice(pos));
  if (keyword || bold) {
    // Malformed string: no styling, and stars still glued to a word (`**Foo*`) are
    // treated as broken markers too. Free-standing stars (`a * b`) stay.
    const text = raw
      .map((g) => g.text)
      .join('')
      .replace(GLUED_STAR, '');
    return text ? [{ text, keyword: false, bold: false }] : [];
  }
  return raw;
}

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\n';

/**
 * Display form: {@link tokenizeMarkup}, then whitespace runs (including NBSP and newlines)
 * collapse to one space, also across removed markup, and the ends are trimmed.
 *
 * With `keepLineBreaks`, a whitespace run containing a newline becomes one `\n` instead (a
 * break wins over an adjacent space across removed markup), so bullet lists stay on their own
 * lines; the joined text then differs from {@link stripBsdataMarkup} only in those breaks.
 */
export function parseBsdataMarkup(
  input: string,
  options: ParseMarkupOptions = {},
): MarkupSegment[] {
  const keepLineBreaks = options.keepLineBreaks === true;
  const out: MarkupSegment[] = [];
  for (const g of tokenizeMarkup(input)) {
    let text = keepLineBreaks
      ? g.text.replace(/\s+/g, (ws) => (ws.includes('\n') ? '\n' : ' '))
      : g.text.replace(/\s+/g, ' ');
    const last = out[out.length - 1];
    if (isSpace(text[0])) {
      if (!last) {
        text = text.slice(1); // start of string: trim leading space
      } else if (isSpace(last.text.at(-1))) {
        if (text[0] === '\n') last.text = `${last.text.slice(0, -1)}\n`;
        text = text.slice(1);
      }
    }
    if (!text) continue;
    if (last && sameStyle(last, g.keyword, g.bold, g.italic)) last.text += text;
    else out.push(makeSegment(text, g.keyword, g.bold, g.italic === true));
  }
  const end = out[out.length - 1];
  if (end) {
    end.text = end.text.trimEnd();
    if (!end.text) out.pop();
  }
  return out;
}

/** Single-line plain text with all markup removed and whitespace collapsed (display). */
export function stripBsdataMarkup(input: string): string {
  return parseBsdataMarkup(input)
    .map((g) => g.text)
    .join('');
}

/**
 * Plain text with all markup tokens removed and whitespace (newlines, paragraph breaks)
 * kept verbatim. This is what the data build stores in `effectPlain`.
 */
export function toPlain(input: string): string {
  return tokenizeMarkup(input)
    .map((g) => g.text)
    .join('');
}

/**
 * Display form of a game keyword for a small-caps face. An all-caps string (INFANTRY,
 * OGOR MAWTRIBES) is re-cased to capitalised words; mixed-case input is left alone.
 */
export function displayKeyword(input: string): string {
  if (input !== input.toUpperCase()) return input;
  return input
    .toLowerCase()
    .replace(/(^|[\s\-‐-―([])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}
