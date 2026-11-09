/**
 * Key-sequence state machine of the calculator.
 *
 * Documented structure (Dutch 2001 rule book, button overview): an operation is entered as
 *   pawn (player) → two-digit company number → action → quantity.
 * The exact key caps of the original unit could not be verified (see docs/RESEARCH.md),
 * so the key set below is a reconstruction that follows that documented order.
 */
import { COMPANY_COUNT, MAX_PLAYERS } from './data';
import { apply, isFloated, type Action, type ErrorCode, type GameEvent, type GameState } from './game';
import type { KeypadError } from './messages';

export type PlayerKey = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
export type DigitKey = 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9';
export type OpKey = 'BUY' | 'SELL' | 'RENT' | 'GO' | 'OFFICE' | 'TRANSFER';
export type Key = PlayerKey | DigitKey | OpKey | 'ENTER' | 'CLEAR' | 'PREV' | 'NEXT';

export const PLAYER_KEYS: PlayerKey[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
export const OP_KEYS: OpKey[] = ['BUY', 'SELL', 'RENT', 'GO', 'OFFICE', 'TRANSFER'];

export interface Entry {
  player: number | null;
  company: number | null;
  op: OpKey | null;
  target: number | null;
  digits: string;
}

export interface KeypadState {
  entry: Entry;
  /** Company currently shown in the browse view (1‥22). */
  view: number;
  /** Showing a player summary (after "player, =") */
  playerView: number | null;
  result: GameEvent | null;
  error: ErrorCode | KeypadError | null;
}

export type Feedback = 'key' | 'ok' | 'error';

export interface PressResult {
  keypad: KeypadState;
  game: GameState;
  /** Set when an operation was committed. */
  event?: GameEvent;
  feedback: Feedback;
}

export const EMPTY_ENTRY: Entry = { player: null, company: null, op: null, target: null, digits: '' };

export function initialKeypad(): KeypadState {
  return { entry: { ...EMPTY_ENTRY }, view: 1, playerView: null, result: null, error: null };
}

export function isPlayerKey(k: Key): k is PlayerKey {
  return k.length === 2 && k[0] === 'P';
}
export function isDigitKey(k: Key): k is DigitKey {
  return k.length === 2 && k[0] === 'D';
}
export function isOpKey(k: Key): k is OpKey {
  return (OP_KEYS as string[]).includes(k);
}

/** Does the current entry expect a quantity typed on the digit keys? */
export function expectsCount(game: GameState, e: Entry): boolean {
  switch (e.op) {
    case 'BUY':
      return e.company !== null && isFloated(game, e.company);
    case 'SELL':
    case 'OFFICE':
      return true;
    case 'TRANSFER':
      return e.target !== null;
    default:
      return false;
  }
}

/** Build the engine action that the current entry describes (for preview and commit). */
export function entryAction(game: GameState, e: Entry): { action: Action } | { error: KeypadError } {
  if (!e.op) return { error: 'NEED_COMPANY' };
  const count = e.digits === '' ? null : parseInt(e.digits, 10);
  switch (e.op) {
    case 'GO':
      if (e.player === null) return { error: 'NEED_PLAYER' };
      return { action: { type: 'go', player: e.player } };
    case 'RENT':
      if (e.player === null) return { error: 'NEED_PLAYER' };
      if (e.company === null) return { error: 'NEED_COMPANY' };
      return { action: { type: 'rent', player: e.player, company: e.company } };
    case 'BUY':
      if (e.player === null) return { error: 'NEED_PLAYER' };
      if (e.company === null) return { error: 'NEED_COMPANY' };
      if (!isFloated(game, e.company)) return { action: { type: 'float', player: e.player, company: e.company } };
      if (count === null) return { error: 'NEED_COUNT' };
      return { action: { type: 'buy', player: e.player, company: e.company, count } };
    case 'SELL':
      if (e.player === null) return { error: 'NEED_PLAYER' };
      if (e.company === null) return { error: 'NEED_COMPANY' };
      if (count === null) return { error: 'NEED_COUNT' };
      return { action: { type: 'sell', player: e.player, company: e.company, count } };
    case 'OFFICE':
      if (e.company === null) return { error: 'NEED_COMPANY' };
      if (count === null) return { error: 'NEED_COUNT' };
      return { action: { type: 'buildings', company: e.company, count } };
    case 'TRANSFER':
      if (e.player === null) return { error: 'NEED_PLAYER' };
      if (e.company === null) return { error: 'NEED_COMPANY' };
      if (e.target === null) return { error: 'NEED_TARGET' };
      if (count === null) return { error: 'NEED_COUNT' };
      return { action: { type: 'transfer', from: e.player, to: e.target, company: e.company, count } };
  }
}

function parseCompany(digits: string): number | null {
  if (digits === '') return null;
  const n = parseInt(digits, 10);
  return n >= 1 && n <= COMPANY_COUNT ? n : -1;
}

export function press(kp: KeypadState, game: GameState, key: Key): PressResult {
  const base: KeypadState = { ...kp, entry: { ...kp.entry }, error: null };
  const ok = (keypad: KeypadState, feedback: Feedback = 'key'): PressResult => ({ keypad, game, feedback });
  const err = (error: KeypadState['error']): PressResult => ({
    keypad: { ...base, error, entry: { ...base.entry, digits: '' } },
    game,
    feedback: 'error',
  });

  // A finished result (or a player summary) is dismissed by the next key.
  const fresh = kp.result !== null || kp.playerView !== null;
  if (fresh) {
    base.result = null;
    base.playerView = null;
    base.entry = { ...EMPTY_ENTRY };
  }
  const e = base.entry;

  if (isPlayerKey(key)) {
    const p = PLAYER_KEYS.indexOf(key);
    if (p >= game.playerCount || p >= MAX_PLAYERS) return err('BAD_PLAYER');
    if (e.op === 'TRANSFER' && e.player !== null && e.company !== null && e.target === null) {
      if (p === e.player) return err('SAME_PLAYER');
      e.target = p;
      e.digits = '';
      return ok(base);
    }
    base.entry = { ...EMPTY_ENTRY, player: p };
    return ok(base);
  }

  if (isDigitKey(key)) {
    const d = key[1];
    const counting = e.op !== null && expectsCount(game, e);
    if (counting) e.digits = d; // quantities are single digits (0‥9)
    else if (e.op === null) e.digits = (e.digits + d).slice(-2); // company number: last two digits
    else return ok(base); // op waiting for something else (e.g. transfer target) – ignore digit
    return ok(base);
  }

  if (isOpKey(key)) {
    if (e.op !== null) {
      // switching operation mid-entry (e.g. BUY → SELL): keep player and company, drop the quantity
      e.digits = '';
    } else if (e.digits !== '') {
      const n = parseCompany(e.digits);
      if (n === -1) return err('BAD_COMPANY');
      e.company = n;
      e.digits = '';
    }
    e.op = key;
    e.target = null;
    if (key === 'GO') {
      if (e.player === null) return err('NEED_PLAYER');
      e.company = null;
    } else {
      if (key !== 'OFFICE' && e.player === null) return err('NEED_PLAYER');
      if (e.company === null) return err('NEED_COMPANY');
      base.view = e.company;
    }
    return ok(base);
  }

  switch (key) {
    case 'ENTER': {
      if (e.op === null) {
        if (e.digits !== '') {
          const n = parseCompany(e.digits);
          if (n === -1) return err('BAD_COMPANY');
          base.view = n!;
          base.entry = { ...EMPTY_ENTRY, player: e.player };
          return ok(base);
        }
        if (e.player !== null) {
          base.playerView = e.player;
          base.entry = { ...EMPTY_ENTRY };
          return ok(base);
        }
        return ok(base);
      }
      const built = entryAction(game, e);
      if ('error' in built) return err(built.error);
      const res = apply(game, built.action);
      if (!res.ok) return err(res.error);
      return {
        keypad: { ...base, entry: { ...EMPTY_ENTRY }, result: res.event, error: null },
        game: res.state,
        event: res.event,
        feedback: 'ok',
      };
    }
    case 'CLEAR': {
      if (kp.error) return ok({ ...base });
      if (e.digits !== '') {
        e.digits = '';
        return ok(base);
      }
      return ok({ ...base, entry: { ...EMPTY_ENTRY } });
    }
    case 'PREV':
    case 'NEXT': {
      const delta = key === 'NEXT' ? 1 : -1;
      const view = ((base.view - 1 + delta + COMPANY_COUNT) % COMPANY_COUNT) + 1;
      return ok({ ...base, view, entry: { ...EMPTY_ENTRY } });
    }
  }
  return ok(base);
}

/** Convenience for tests and scripted input: press a whole sequence. */
export function pressAll(kp: KeypadState, game: GameState, keys: Key[]): PressResult & { events: GameEvent[] } {
  let r: PressResult = { keypad: kp, game, feedback: 'key' };
  const events: GameEvent[] = [];
  for (const k of keys) {
    r = press(r.keypad, r.game, k);
    if (r.event) events.push(r.event);
  }
  return { ...r, events };
}

/** Parse a compact sequence string such as "P1 09 BUY 2 =" into keys. */
export function parseSequence(seq: string): Key[] {
  const keys: Key[] = [];
  for (const tok of seq.trim().split(/\s+/)) {
    if (tok === '=') keys.push('ENTER');
    else if (tok === 'C') keys.push('CLEAR');
    else if (/^\d+$/.test(tok)) for (const ch of tok) keys.push(`D${ch}` as DigitKey);
    else keys.push(tok as Key);
  }
  return keys;
}
