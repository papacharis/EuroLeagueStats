import {
  COMPANIES,
  COMPANY_COUNT,
  FLOAT_SHARES,
  GROUPS,
  MAX_BUILDINGS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PRICE_FLUCTUATION,
  SHARES_PER_COMPANY,
  company,
} from './data';
import { basePrice, rentQuote, type RentQuote } from './pricing';
import { nextInt, randomSeed } from './rng';

export type GameMode = 'original' | 'simulation';

export interface CompanyState {
  /** Shares held per player (index = player 0‥playerCount-1). */
  shares: number[];
  /** 0‥4 offices, 5 = head office. */
  buildings: number;
  /** Player index of the president or null if the company is not floated. */
  president: number | null;
}

export interface SimulationConfig {
  startCash: number;
  goSalary: number;
}

export interface GameState {
  version: 1;
  mode: GameMode;
  playerCount: number;
  playerNames: string[];
  companies: CompanyState[];
  /** Dividends accrued inside the unit, paid out when the player passes GO. */
  dividends: number[];
  /** Simulation Mode only: cash ledger per player. */
  cash: number[] | null;
  sim: SimulationConfig | null;
  /** Price fluctuation (± PRICE_FLUCTUATION) currently applied to each company. */
  offsets: number[];
  /** Whether prices fluctuate. Always true in Original Mode. */
  fluctuation: boolean;
  rng: number;
  actionCount: number;
  createdAt: number;
}

export interface NewGameOptions {
  playerCount: number;
  playerNames?: string[];
  mode?: GameMode;
  seed?: number;
  sim?: Partial<SimulationConfig>;
  /** Simulation Mode only. */
  fluctuation?: boolean;
  now?: number;
}

export const DEFAULT_SIM: SimulationConfig = { startCash: 1500, goSalary: 200 };

export function defaultPlayerName(i: number): string {
  return `Παίκτης ${i + 1}`;
}

export function newGame(opts: NewGameOptions): GameState {
  const { playerCount } = opts;
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new RangeError(`playerCount must be ${MIN_PLAYERS}‥${MAX_PLAYERS}`);
  }
  const mode = opts.mode ?? 'original';
  const sim = mode === 'simulation' ? { ...DEFAULT_SIM, ...opts.sim } : null;
  return {
    version: 1,
    mode,
    playerCount,
    playerNames: Array.from({ length: playerCount }, (_, i) => opts.playerNames?.[i]?.trim() || defaultPlayerName(i)),
    companies: Array.from({ length: COMPANY_COUNT }, () => ({
      shares: Array(playerCount).fill(0),
      buildings: 0,
      president: null,
    })),
    dividends: Array(playerCount).fill(0),
    cash: sim ? Array(playerCount).fill(sim.startCash) : null,
    sim,
    offsets: Array(COMPANY_COUNT).fill(0),
    fluctuation: mode === 'original' ? true : (opts.fluctuation ?? true),
    rng: (opts.seed ?? randomSeed()) >>> 0,
    actionCount: 0,
    createdAt: opts.now ?? Date.now(),
  };
}

// ───────────────────────── derived values ─────────────────────────

export function cstate(state: GameState, n: number): CompanyState {
  const c = state.companies[n - 1];
  if (!c) throw new RangeError(`company ${n}`);
  return c;
}

export function sharesSold(state: GameState, n: number): number {
  return cstate(state, n).shares.reduce((a, b) => a + b, 0);
}

export function sharesAvailable(state: GameState, n: number): number {
  return SHARES_PER_COMPANY - sharesSold(state, n);
}

export function holders(state: GameState, n: number): number {
  return cstate(state, n).shares.filter((s) => s > 0).length;
}

export function isFloated(state: GameState, n: number): boolean {
  return sharesSold(state, n) > 0;
}

export function groupMembers(n: number): number[] {
  return GROUPS[company(n).group];
}

/** Monopoly = the same player is president of every company of the colour group. */
export function isMonopoly(state: GameState, n: number): boolean {
  const members = groupMembers(n);
  const p = cstate(state, members[0]).president;
  if (p === null) return false;
  return members.every((m) => cstate(state, m).president === p);
}

/** Centre share price without fluctuation, or null if not floated. */
export function centrePrice(state: GameState, n: number): number | null {
  const sold = sharesSold(state, n);
  if (sold === 0) return null;
  return basePrice(n, holders(state, n), sold, isMonopoly(state, n), cstate(state, n).buildings);
}

/** Price per share currently shown on the unit, or null if not floated. */
export function currentPrice(state: GameState, n: number): number | null {
  const centre = centrePrice(state, n);
  if (centre === null) return null;
  const offset = state.fluctuation ? state.offsets[n - 1] : 0;
  return Math.max(1, centre + offset);
}

export function rentFor(state: GameState, player: number, n: number): RentQuote {
  const c = cstate(state, n);
  return rentQuote(n, c.shares[player], sharesSold(state, n), isMonopoly(state, n), c.buildings);
}

export function totalShares(state: GameState, player: number): number {
  return state.companies.reduce((a, c) => a + c.shares[player], 0);
}

/** Market value (current price × shares) of a player's portfolio. */
export function portfolioValue(state: GameState, player: number): number {
  let total = 0;
  for (let n = 1; n <= COMPANY_COUNT; n++) {
    const s = cstate(state, n).shares[player];
    if (s > 0) total += s * (currentPrice(state, n) ?? 0);
  }
  return total;
}

// ───────────────────────── actions ─────────────────────────

export type Action =
  | { type: 'float'; player: number; company: number }
  | { type: 'buy'; player: number; company: number; count: number }
  | { type: 'sell'; player: number; company: number; count: number }
  | { type: 'transfer'; from: number; to: number; company: number; count: number }
  | { type: 'rent'; player: number; company: number }
  | { type: 'go'; player: number }
  | { type: 'buildings'; company: number; count: number }
  | { type: 'cash'; player: number; amount: number };

export type ErrorCode =
  | 'BAD_PLAYER'
  | 'BAD_COMPANY'
  | 'BAD_COUNT'
  | 'ALREADY_FLOATED'
  | 'NOT_FLOATED'
  | 'NOT_ENOUGH_AVAILABLE'
  | 'NOT_ENOUGH_OWNED'
  | 'SAME_PLAYER'
  | 'NO_MONOPOLY'
  | 'NO_RENT_DUE'
  | 'SIMULATION_ONLY';

/** What happened – used for the history log and for the LCD result. */
export interface GameEvent {
  action: Action;
  /** Money amount shown to the players (cost, proceeds, rent, dividend …). */
  amount: number;
  /** Price per share used for buy/sell. */
  unitPrice?: number;
  /** Rent: dividend credited to each player. */
  credited?: number[];
  presidentBefore?: number | null;
  presidentAfter?: number | null;
}

export type ActionResult = { ok: true; state: GameState; event: GameEvent } | { ok: false; error: ErrorCode };

function clone(state: GameState): GameState {
  return {
    ...state,
    playerNames: [...state.playerNames],
    companies: state.companies.map((c) => ({ ...c, shares: [...c.shares] })),
    dividends: [...state.dividends],
    cash: state.cash ? [...state.cash] : null,
    sim: state.sim ? { ...state.sim } : null,
    offsets: [...state.offsets],
  };
}

function validPlayer(state: GameState, p: number): boolean {
  return Number.isInteger(p) && p >= 0 && p < state.playerCount;
}

function validCompany(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= COMPANY_COUNT;
}

function validCount(k: number): boolean {
  return Number.isInteger(k) && k >= 1 && k <= SHARES_PER_COMPANY;
}

/** Presidency: the largest holder; the incumbent keeps it on a tie. */
function updatePresident(c: CompanyState): void {
  const max = Math.max(...c.shares);
  if (max === 0) {
    c.president = null;
    c.buildings = 0;
    return;
  }
  if (c.president !== null && c.shares[c.president] === max) return;
  c.president = c.shares.findIndex((s) => s === max);
}

/** Re-roll the ± fluctuation of every company ("market tick" after each completed operation). */
function tick(state: GameState): void {
  state.actionCount += 1;
  if (!state.fluctuation) return;
  let rng = state.rng;
  for (let i = 0; i < COMPANY_COUNT; i++) {
    const [v, next] = nextInt(rng, -PRICE_FLUCTUATION, PRICE_FLUCTUATION);
    state.offsets[i] = v;
    rng = next;
  }
  state.rng = rng;
}

function addCash(state: GameState, player: number, amount: number): void {
  if (state.cash) state.cash[player] += amount;
}

export function apply(state: GameState, action: Action): ActionResult {
  const s = clone(state);
  const fail = (error: ErrorCode): ActionResult => ({ ok: false, error });

  switch (action.type) {
    case 'float': {
      const { player, company: n } = action;
      if (!validPlayer(s, player)) return fail('BAD_PLAYER');
      if (!validCompany(n)) return fail('BAD_COMPANY');
      if (isFloated(s, n)) return fail('ALREADY_FLOATED');
      const c = cstate(s, n);
      c.shares[player] = FLOAT_SHARES;
      c.president = player;
      const amount = COMPANIES[n - 1].value;
      addCash(s, player, -amount);
      tick(s);
      return { ok: true, state: s, event: { action, amount, presidentBefore: null, presidentAfter: player } };
    }

    case 'buy':
    case 'sell': {
      const { player, company: n, count } = action;
      if (!validPlayer(s, player)) return fail('BAD_PLAYER');
      if (!validCompany(n)) return fail('BAD_COMPANY');
      if (!validCount(count)) return fail('BAD_COUNT');
      if (!isFloated(s, n)) return fail('NOT_FLOATED');
      const c = cstate(s, n);
      if (action.type === 'buy' && sharesAvailable(s, n) < count) return fail('NOT_ENOUGH_AVAILABLE');
      if (action.type === 'sell' && c.shares[player] < count) return fail('NOT_ENOUGH_OWNED');
      const unitPrice = currentPrice(s, n)!;
      const amount = unitPrice * count;
      const before = c.president;
      c.shares[player] += action.type === 'buy' ? count : -count;
      updatePresident(c);
      addCash(s, player, action.type === 'buy' ? -amount : amount);
      tick(s);
      return { ok: true, state: s, event: { action, amount, unitPrice, presidentBefore: before, presidentAfter: c.president } };
    }

    case 'transfer': {
      const { from, to, company: n, count } = action;
      if (!validPlayer(s, from) || !validPlayer(s, to)) return fail('BAD_PLAYER');
      if (from === to) return fail('SAME_PLAYER');
      if (!validCompany(n)) return fail('BAD_COMPANY');
      if (!validCount(count)) return fail('BAD_COUNT');
      const c = cstate(s, n);
      if (c.shares[from] < count) return fail('NOT_ENOUGH_OWNED');
      const before = c.president;
      c.shares[from] -= count;
      c.shares[to] += count;
      updatePresident(c);
      tick(s);
      return { ok: true, state: s, event: { action, amount: 0, presidentBefore: before, presidentAfter: c.president } };
    }

    case 'rent': {
      const { player, company: n } = action;
      if (!validPlayer(s, player)) return fail('BAD_PLAYER');
      if (!validCompany(n)) return fail('BAD_COMPANY');
      if (!isFloated(s, n)) return fail('NOT_FLOATED');
      const q = rentFor(s, player, n);
      if (q.total === 0) return fail('NO_RENT_DUE');
      const c = cstate(s, n);
      const credited = c.shares.map((sh, i) => (i === player ? 0 : sh * q.perShare));
      credited.forEach((v, i) => (s.dividends[i] += v));
      addCash(s, player, -q.total);
      tick(s);
      return { ok: true, state: s, event: { action, amount: q.total, unitPrice: q.perShare, credited } };
    }

    case 'go': {
      const { player } = action;
      if (!validPlayer(s, player)) return fail('BAD_PLAYER');
      const amount = s.dividends[player];
      s.dividends[player] = 0;
      addCash(s, player, amount + (s.sim?.goSalary ?? 0));
      tick(s);
      return { ok: true, state: s, event: { action, amount } };
    }

    case 'buildings': {
      const { company: n, count } = action;
      if (!validCompany(n)) return fail('BAD_COMPANY');
      if (!Number.isInteger(count) || count < 0 || count > MAX_BUILDINGS) return fail('BAD_COUNT');
      if (count > 0 && !isMonopoly(s, n)) return fail('NO_MONOPOLY');
      cstate(s, n).buildings = count;
      tick(s);
      return { ok: true, state: s, event: { action, amount: 0 } };
    }

    case 'cash': {
      if (!s.cash) return fail('SIMULATION_ONLY');
      if (!validPlayer(s, action.player)) return fail('BAD_PLAYER');
      if (!Number.isFinite(action.amount)) return fail('BAD_COUNT');
      s.cash[action.player] += Math.trunc(action.amount);
      return { ok: true, state: s, event: { action, amount: Math.trunc(action.amount) } };
    }
  }
}

/** Quote what an action would cost/pay without applying it (used for the LCD preview). */
export function quote(state: GameState, action: Action): ActionResult {
  return apply(state, action);
}
