import { Fragment } from 'react';
import { displayKeyword, parseBsdataMarkup } from '../../data/markup.js';

/** BSData rules text: **bold**, ^^KEYWORDS^^, *italics* and line breaks. */
export function Markup({ text }: { text: string }) {
  const segments = parseBsdataMarkup(text, { keepLineBreaks: true });
  return (
    <>
      {segments.map((s, i) => {
        const lines = s.text.split('\n');
        const body = lines.map((line, k) => (
          <Fragment key={k}>
            {k > 0 && <br />}
            {s.keyword ? displayKeyword(line) : line}
          </Fragment>
        ));
        let node = <>{body}</>;
        if (s.keyword) node = <span className="kw">{node}</span>;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong>{node}</strong>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}
