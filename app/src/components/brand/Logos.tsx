// Serra brand marks as React components (serra_brand/logos/svg, on-dark versions).

import { ARCS, ARC_PATHS, NODE_WORD, SERRA_WORD } from './paths';

const FOG = '#EEF1EC';
const FLARE = '#FF5A1F';
const MOSS = '#8FA397';

const arcProps = { fill: 'none', stroke: FOG, strokeWidth: 7, strokeLinecap: 'round' } as const;

/** serra lockup: the call mark plus the wordmark. `animated` sends the three arcs out on repeat. */
export function SerraLogo({
  animated = false,
  className = 'logo',
}: {
  animated?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 20.7 338.23 69"
      width="338.23"
      height="69"
      role="img"
      aria-label="serra logo"
    >
      <title>serra logo</title>
      <g transform="translate(-11.5 9.2) scale(1.4375)">
        <circle cx="16" cy="32" r="7.5" fill={FLARE} />
        {animated ? (
          ARC_PATHS.map((d, i) => <path key={d} className={`arc a${i + 1}`} d={d} {...arcProps} />)
        ) : (
          <path d={ARCS} {...arcProps} />
        )}
      </g>
      <path d={SERRA_WORD} fill={FOG} transform="translate(120.63 0)" />
    </svg>
  );
}

/** serranet mark: three nodes, the top one calling. Spins as the loading indicator. */
export function SerranetMark({
  spinning = false,
  style,
}: {
  spinning?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={spinning ? 'logo serranet-loading' : 'logo'}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 4.77 52 52"
      width="52"
      height="52"
      role="img"
      aria-label="serranet mark"
    >
      <title>serranet mark</title>
      <circle cx="26" cy="12.3" r="7.5" fill={FLARE} />
      <circle cx="10" cy="40" r="7.5" fill={FOG} />
      <circle cx="42" cy="40" r="7.5" fill={FOG} />
    </svg>
  );
}

/** The serranode mark's "( )" arcs around the dot: one node listening in all directions. */
const NODE_ARCS = 'M30.29 11.93A30 30 0 0 1 30.29 52.07M1.71 11.93A30 30 0 0 0 1.71 52.07';

/** serranode lockup: the (•) mark, "serra" in Fog, "node" in Moss. */
export function SerranodeLogo() {
  return (
    <svg
      className="logo"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 14 545.97 83.1"
      width="545.97"
      height="83.1"
      role="img"
      aria-label="serranode logo"
    >
      <title>serranode logo</title>
      <g transform="translate(17.17 0.97) scale(1.7167)">
        <circle cx="16" cy="32" r="7.5" fill={FLARE} />
        <path d={NODE_ARCS} {...arcProps} />
      </g>
      <path d={SERRA_WORD} fill={FOG} transform="translate(110.37 0)" />
      <path d={NODE_WORD} fill={MOSS} transform="translate(110.37 0)" />
    </svg>
  );
}

/** Small call mark for buttons, in the current text color. */
export function CallIcon() {
  return (
    <svg width="18" height="14" viewBox="8 8 70 48" aria-hidden="true">
      <circle cx="16" cy="32" r="7.5" fill="currentColor" />
      <path d={ARCS} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/** The arcs alone, for the loading screen's morph. */
export function Arcs() {
  return (
    <>
      {ARC_PATHS.map((d, i) => (
        <path key={d} className={`arc a${i + 1}`} d={d} {...arcProps} />
      ))}
    </>
  );
}
