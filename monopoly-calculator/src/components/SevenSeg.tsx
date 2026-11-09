/** SVG seven-segment digit with "ghost" segments, like a real reflective LCD. */
const SEGMENTS: Record<string, string> = {
  a: '2,1 10,1 8.6,2.6 3.4,2.6',
  b: '10.4,1.6 10.4,9.3 9,8.4 9,3',
  c: '10.4,10.7 10.4,18.4 9,17 9,11.6',
  d: '2,19 10,19 8.6,17.4 3.4,17.4',
  e: '1.6,10.7 1.6,18.4 3,17 3,11.6',
  f: '1.6,1.6 1.6,9.3 3,8.4 3,3',
  g: '2.2,10 3.4,9.2 8.6,9.2 9.8,10 8.6,10.8 3.4,10.8',
};

const CHAR_SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  _: 'd',
  E: 'adefg',
  r: 'eg',
  P: 'abefg',
  ' ': '',
};

export function SevenSegDigit({ ch, all = false }: { ch: string; all?: boolean }) {
  const on = all ? 'abcdefg' : (CHAR_SEGMENTS[ch] ?? '');
  return (
    <svg viewBox="0 0 12 20" className="seg-digit" aria-hidden="true">
      {Object.entries(SEGMENTS).map(([k, pts]) => (
        <polygon key={k} points={pts} className={on.includes(k) ? 'seg-on' : 'seg-off'} transform="skewX(-6) translate(1 0)" />
      ))}
    </svg>
  );
}

/** Right-aligned number field of fixed width. */
export function SevenSegField({
  value,
  width,
  all = false,
  blink = false,
  className = '',
  label,
}: {
  value: string;
  width: number;
  all?: boolean;
  blink?: boolean;
  className?: string;
  label?: string;
}) {
  const text = value.length > width ? value.slice(-width) : value.padStart(width, ' ');
  return (
    <span className={`seg-field ${blink ? 'seg-blink' : ''} ${className}`} role="img" aria-label={label ?? value.trim()}>
      {text.split('').map((c, i) => (
        <SevenSegDigit key={i} ch={c} all={all} />
      ))}
    </span>
  );
}
