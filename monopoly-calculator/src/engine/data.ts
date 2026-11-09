/**
 * Static data of the Monopoly Stock Exchange (2001) electronic unit.
 *
 * Source of every number in this file: the reverse-engineering project
 * "moose – Unraveling the Monopoly Stock Exchange Computer"
 * (https://github.com/warendorff/moose, index.md, revision of June 2026),
 * whose authors read the raw tables out of a real unit and fitted formulas to them.
 * See docs/RESEARCH.md for the full source discussion.
 */

export const COMPANY_COUNT = 22;
export const SHARES_PER_COMPANY = 9;
/** Shares bought by the first player who floats a company (simple majority of 9). */
export const FLOAT_SHARES = 5;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
/** 4 offices + 1 head office. */
export const MAX_BUILDINGS = 5;

export type GroupId = 'brown' | 'lightblue' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'darkblue';

export interface CompanyDef {
  /** 1‥22 – the two-digit number typed on the unit. */
  number: number;
  /** Value printed on the board / deed (price of the 5-share flotation block). */
  value: number;
  /** Rent with no monopoly and no offices (before the shareholding discount). */
  baseRent: number;
  group: GroupId;
  /** Company name in the UK edition – for reference only; the unit itself only knows numbers. */
  ukName: string;
}

const VALUES = [60, 60, 100, 100, 120, 140, 140, 160, 180, 180, 200, 220, 220, 240, 260, 260, 280, 300, 300, 320, 350, 400];
const BASE_RENTS = [4, 8, 12, 12, 16, 20, 20, 24, 28, 28, 32, 36, 36, 40, 44, 44, 48, 52, 52, 56, 70, 100];
const UK_NAMES = [
  'Gillette', 'Unilever', 'KLM', 'Swissair', 'British Airways', 'United Colors of Benetton', 'Swatch',
  'Marks & Spencer', "T.G.I. Friday's", 'Pizza Hut', 'Burger King', 'MG Rover Group', 'Peugeot',
  'DaimlerChrysler', 'Electrolux', 'Mitsubishi Electric', 'Toshiba', 'Alcatel', 'Siemens', 'Nokia',
  'Telefónica', 'BT',
];

export const GROUPS: Record<GroupId, number[]> = {
  brown: [1, 2],
  lightblue: [3, 4, 5],
  pink: [6, 7, 8],
  orange: [9, 10, 11],
  red: [12, 13, 14],
  yellow: [15, 16, 17],
  green: [18, 19, 20],
  darkblue: [21, 22],
};

export const GROUP_COLORS: Record<GroupId, string> = {
  brown: '#8a5a3b',
  lightblue: '#8fd0f0',
  pink: '#d6409f',
  orange: '#f08a24',
  red: '#d63a2f',
  yellow: '#f2d22e',
  green: '#2f8f4e',
  darkblue: '#24408e',
};

function groupOf(n: number): GroupId {
  for (const [g, members] of Object.entries(GROUPS)) if (members.includes(n)) return g as GroupId;
  throw new Error(`no group for company ${n}`);
}

export const COMPANIES: readonly CompanyDef[] = VALUES.map((value, i) => ({
  number: i + 1,
  value,
  baseRent: BASE_RENTS[i],
  group: groupOf(i + 1),
  ukName: UK_NAMES[i],
}));

/**
 * lookupValue[players][sharesSold] – players holding shares (1‥6) × total shares sold (1‥9).
 * `null` marks impossible combinations (more holders than shares).
 */
export const PRICE_LOOKUP: readonly (readonly (number | null)[])[] = [
  // shares:  1     2     3     4     5     6     7     8     9
  /* 1 */ [6, 7, 8, 9, 10, 10, 10, 10, 10],
  /* 2 */ [null, 8, 9, 10, 11, 12, 12, 12, 12],
  /* 3 */ [null, null, 10, 11, 12, 13, 14, 14, 15],
  /* 4 */ [null, null, null, 12, 13, 14, 15, 16, 17],
  /* 5 */ [null, null, null, null, 14, 15, 16, 18, 20],
  /* 6 */ [null, null, null, null, null, 16, 18, 20, 23],
];

/** Price factor: index 0 = no offices (7 without / 12 with monopoly), 1‥5 = buildings. */
export const FACTOR_NO_MONOPOLY = 7;
export const FACTOR_MONOPOLY = 12;
export const FACTOR_BUILDINGS = [0, 14, 17, 20, 22, 28] as const;

/** Divisor applied to the company value in the share-price formula. */
export const PRICE_DIVISOR = 320;
/** The displayed price wanders within ± this amount of the computed value. */
export const PRICE_FLUCTUATION = 6;

/**
 * Effective base rent once 1‥5 offices are built, keyed by the company's base rent.
 * Hand-authored data in the unit (no formula reproduces it).
 */
export const OFFICE_RENT: Readonly<Record<number, readonly [number, number, number, number, number]>> = {
  4: [20, 60, 180, 320, 500],
  8: [40, 120, 280, 380, 480],
  12: [60, 180, 540, 800, 1100],
  16: [80, 200, 600, 900, 1200],
  20: [100, 300, 900, 1250, 1500],
  24: [120, 360, 1000, 1400, 1800],
  28: [140, 400, 1100, 1500, 1900],
  32: [160, 440, 1200, 1600, 2000],
  36: [180, 500, 1400, 1750, 2100],
  40: [200, 600, 1500, 1850, 2300],
  44: [220, 660, 1600, 1950, 2300],
  48: [240, 720, 1700, 2050, 2400],
  52: [260, 780, 1800, 2200, 2550],
  56: [300, 900, 2000, 2400, 2800],
  70: [350, 1000, 2200, 2600, 3000],
  100: [400, 1200, 2800, 3400, 4000],
};

export function company(n: number): CompanyDef {
  const c = COMPANIES[n - 1];
  if (!c) throw new RangeError(`company ${n} out of range 1‥${COMPANY_COUNT}`);
  return c;
}
