import type { SVGProps } from 'react';
import type { Footprint } from '../../geom/index.js';

type Props = { fp: Footprint; grow?: number } & Omit<SVGProps<SVGElement>, 'ref'>;

/** A base outline in table inches: circle, rotated ellipse or rotated rectangle. */
export function Shape({ fp, grow = 0, ...rest }: Props) {
  const p = rest as SVGProps<SVGCircleElement> &
    SVGProps<SVGEllipseElement> &
    SVGProps<SVGRectElement>;
  if (fp.kind === 'circle') return <circle cx={fp.cx} cy={fp.cy} r={fp.r + grow} {...p} />;
  const transform = fp.rotation ? `rotate(${fp.rotation} ${fp.cx} ${fp.cy})` : undefined;
  if (fp.kind === 'ellipse') {
    return (
      <ellipse
        cx={fp.cx}
        cy={fp.cy}
        rx={fp.rx + grow}
        ry={fp.ry + grow}
        transform={transform}
        {...p}
      />
    );
  }
  return (
    <rect
      x={fp.cx - fp.hw - grow}
      y={fp.cy - fp.hh - grow}
      width={2 * (fp.hw + grow)}
      height={2 * (fp.hh + grow)}
      rx={0.1}
      transform={transform}
      {...p}
    />
  );
}
