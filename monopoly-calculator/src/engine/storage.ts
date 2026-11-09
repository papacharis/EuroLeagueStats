import { COMPANY_COUNT, MAX_BUILDINGS, MAX_PLAYERS, MIN_PLAYERS, SHARES_PER_COMPANY } from './data';
import type { GameState } from './game';

export const STORAGE_KEY = 'mse-calculator:v1';
export const MAX_UNDO = 50;
export const MAX_LOG = 500;

export interface LogEntry {
  id: number;
  time: number;
  text: string;
  /** Number of the game action (for linking undo ↔ log). */
  actionCount: number;
}

export interface Settings {
  sound: boolean;
  haptics: boolean;
  /** Custom company names for the edition in hand (the unit itself only knows numbers). */
  companyNames: string[];
  showNames: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  haptics: true,
  companyNames: Array(COMPANY_COUNT).fill(''),
  showNames: true,
};

export interface Session {
  game: GameState | null;
  undo: GameState[];
  log: LogEntry[];
  settings: Settings;
}

export function emptySession(): Session {
  return { game: null, undo: [], log: [], settings: { ...DEFAULT_SETTINGS, companyNames: [...DEFAULT_SETTINGS.companyNames] } };
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Structural validation so that a corrupted or foreign localStorage entry can never crash the app. */
export function isValidGame(g: unknown): g is GameState {
  if (!g || typeof g !== 'object') return false;
  const s = g as GameState;
  if (s.version !== 1) return false;
  if (s.mode !== 'original' && s.mode !== 'simulation') return false;
  if (!isInt(s.playerCount, MIN_PLAYERS, MAX_PLAYERS)) return false;
  if (!Array.isArray(s.playerNames) || s.playerNames.length !== s.playerCount) return false;
  if (!Array.isArray(s.companies) || s.companies.length !== COMPANY_COUNT) return false;
  for (const c of s.companies) {
    if (!c || !Array.isArray(c.shares) || c.shares.length !== s.playerCount) return false;
    if (!c.shares.every((x) => isInt(x, 0, SHARES_PER_COMPANY))) return false;
    if (c.shares.reduce((a, b) => a + b, 0) > SHARES_PER_COMPANY) return false;
    if (!isInt(c.buildings, 0, MAX_BUILDINGS)) return false;
    if (c.president !== null && !isInt(c.president, 0, s.playerCount - 1)) return false;
  }
  if (!Array.isArray(s.dividends) || s.dividends.length !== s.playerCount) return false;
  if (!s.dividends.every((x) => typeof x === 'number' && Number.isFinite(x))) return false;
  if (s.cash !== null && (!Array.isArray(s.cash) || s.cash.length !== s.playerCount)) return false;
  if (!Array.isArray(s.offsets) || s.offsets.length !== COMPANY_COUNT) return false;
  if (typeof s.rng !== 'number' || typeof s.fluctuation !== 'boolean') return false;
  return true;
}

export function serialize(session: Session): string {
  return JSON.stringify({
    ...session,
    undo: session.undo.slice(-MAX_UNDO),
    log: session.log.slice(-MAX_LOG),
  });
}

export function deserialize(raw: string | null): Session {
  const fallback = emptySession();
  if (!raw) return fallback;
  let data: Partial<Session>;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!data || typeof data !== 'object') return fallback;
  const game = isValidGame(data.game) ? data.game : null;
  const undo = game && Array.isArray(data.undo) ? data.undo.filter(isValidGame).slice(-MAX_UNDO) : [];
  const log = game && Array.isArray(data.log)
    ? data.log.filter((l): l is LogEntry => !!l && typeof l.text === 'string' && typeof l.time === 'number').slice(-MAX_LOG)
    : [];
  const st = (data.settings ?? {}) as Partial<Settings>;
  const names = Array.isArray(st.companyNames) ? st.companyNames : [];
  const settings: Settings = {
    sound: typeof st.sound === 'boolean' ? st.sound : DEFAULT_SETTINGS.sound,
    haptics: typeof st.haptics === 'boolean' ? st.haptics : DEFAULT_SETTINGS.haptics,
    showNames: typeof st.showNames === 'boolean' ? st.showNames : DEFAULT_SETTINGS.showNames,
    companyNames: Array.from({ length: COMPANY_COUNT }, (_, i) => (typeof names[i] === 'string' ? names[i] : '')),
  };
  return { game, undo, log, settings };
}

export function loadSession(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): Session {
  try {
    return deserialize(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return emptySession();
  }
}

export function saveSession(session: Session, storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage()): boolean {
  try {
    storage?.setItem(STORAGE_KEY, serialize(session));
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
