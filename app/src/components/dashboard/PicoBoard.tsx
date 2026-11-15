// Drawing of the Raspberry Pi Pico 2 W inside a Serranode, labelled with the node's mesh ID.

import { PICO_TRACE } from '../brand/paths';

const MOSS = '#8FA397';
const mono = { fontFamily: 'JetBrains Mono Variable, JetBrains Mono, monospace' };

export function PicoBoard({ tag }: { tag: string }) {
  const pins = Array.from({ length: 20 }, (_, i) => 16 + i * 25.4);
  return (
    <svg viewBox="-20 -14 550 238" role="img" aria-label="Raspberry Pi Pico 2 W inside the Serranode">
      <rect
        x="0"
        y="0"
        width="510"
        height="210"
        rx="10"
        fill="#14211c"
        stroke={MOSS}
        strokeOpacity=".55"
        strokeWidth="2"
      />
      <g id="pins">
        {pins.map((x) => (
          <g key={x}>
            <circle cx={x} cy="10" r="6" fill="none" stroke={MOSS} strokeOpacity=".7" strokeWidth="2" />
            <circle cx={x} cy="200" r="6" fill="none" stroke={MOSS} strokeOpacity=".7" strokeWidth="2" />
          </g>
        ))}
      </g>
      {/* USB connector, BOOTSEL button, LED */}
      <rect
        x="-16"
        y="72"
        width="60"
        height="66"
        rx="5"
        fill="#0D1512"
        stroke={MOSS}
        strokeOpacity=".7"
        strokeWidth="2"
      />
      <rect
        x="70"
        y="118"
        width="38"
        height="38"
        rx="5"
        fill="none"
        stroke={MOSS}
        strokeOpacity=".6"
        strokeWidth="2"
      />
      <circle cx="89" cy="137" r="10" fill="none" stroke={MOSS} strokeOpacity=".6" strokeWidth="2" />
      <text x="89" y="174" textAnchor="middle" {...mono} fontSize="9" letterSpacing=".8" fill={MOSS}>
        BOOTSEL
      </text>
      <circle cx="78" cy="52" r="5" fill="#EEF1EC" id="led" />
      <text x="78" y="38" textAnchor="middle" {...mono} fontSize="9" letterSpacing=".8" fill={MOSS}>
        LED
      </text>
      {/* flash, RP2350, CYW43439 radio module and antenna */}
      <rect x="130" y="58" width="44" height="54" rx="4" fill="#0D1512" stroke={MOSS} strokeOpacity=".45" />
      <text x="152" y="89" textAnchor="middle" {...mono} fontSize="8" fill={MOSS}>
        4MB
      </text>
      <rect
        x="196"
        y="62"
        width="84"
        height="84"
        rx="6"
        fill="#0D1512"
        stroke={MOSS}
        strokeOpacity=".6"
        strokeWidth="1.5"
      />
      <text
        x="238"
        y="102"
        textAnchor="middle"
        {...mono}
        fontWeight="500"
        fontSize="12"
        letterSpacing="1"
        fill="#EEF1EC"
      >
        RP2350
      </text>
      <text x="238" y="118" textAnchor="middle" {...mono} fontSize="8" letterSpacing=".8" fill={MOSS}>
        M33 / RV
      </text>
      <rect
        x="312"
        y="44"
        width="118"
        height="122"
        rx="8"
        fill="#1B2B24"
        stroke={MOSS}
        strokeOpacity=".6"
        strokeWidth="1.5"
      />
      <path
        d="M322 54 L420 156 M342 54 L420 136 M322 74 L400 156"
        stroke={MOSS}
        strokeOpacity=".12"
        strokeWidth="10"
      />
      <text x="371" y="110" textAnchor="middle" {...mono} fontSize="9" letterSpacing="1" fill={MOSS}>
        CYW43439
      </text>
      <path
        d={PICO_TRACE}
        fill="none"
        stroke={MOSS}
        strokeOpacity=".6"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <text
        x="132"
        y="34"
        fontFamily="Instrument Sans Variable, Instrument Sans, sans-serif"
        fontWeight="600"
        fontSize="13"
        fill="#EEF1EC"
      >
        Raspberry Pi Pico 2 W
      </text>
      <text
        x="132"
        y="184"
        {...mono}
        fontWeight="500"
        fontSize="12"
        letterSpacing="1.2"
        fill="#EEF1EC"
        id="tag"
      >
        {tag}
      </text>
    </svg>
  );
}
