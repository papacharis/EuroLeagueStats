import type { Key } from './engine/keypad';

export interface KeyDef {
  key: Key;
  label: string;
  sub?: string;
  kind: 'player' | 'digit' | 'op' | 'enter' | 'clear' | 'nav';
  /** Keyboard shortcut shown in help / tooltips. */
  hint: string;
}

/**
 * Reconstructed key caps (the exact caps of the original unit are NOT verified – see docs/RESEARCH.md).
 * Edit this table once photographs of the original keypad are available.
 */
export const PLAYER_ROW: KeyDef[] = [1, 2, 3, 4, 5, 6].map((i) => ({
  key: `P${i}` as Key,
  label: `Π${i}`,
  kind: 'player',
  hint: `Shift+${i} / F${i}`,
}));

const d = (n: number): KeyDef => ({ key: `D${n}` as Key, label: String(n), kind: 'digit', hint: String(n) });

export const MAIN_GRID: KeyDef[] = [
  d(7), d(8), d(9), { key: 'BUY', label: 'ΑΓΟΡΑ', kind: 'op', hint: 'B' },
  d(4), d(5), d(6), { key: 'SELL', label: 'ΠΩΛΗΣΗ', kind: 'op', hint: 'S' },
  d(1), d(2), d(3), { key: 'RENT', label: 'ΕΝΟΙΚΙΟ', kind: 'op', hint: 'R' },
  { key: 'CLEAR', label: 'C', kind: 'clear', hint: 'Esc / Backspace' }, d(0),
  { key: 'ENTER', label: '=', kind: 'enter', hint: 'Enter / =' },
  { key: 'GO', label: 'ΑΦΕΤΗΡΙΑ', kind: 'op', hint: 'G' },
];

export const BOTTOM_ROW: KeyDef[] = [
  { key: 'PREV', label: '◄', kind: 'nav', hint: '←' },
  { key: 'OFFICE', label: 'ΓΡΑΦΕΙΑ', kind: 'op', hint: 'O' },
  { key: 'TRANSFER', label: 'ΜΕΤΑΒΙΒ.', sub: 'μεταβίβαση', kind: 'op', hint: 'T' },
  { key: 'NEXT', label: '►', kind: 'nav', hint: '→' },
];

export const ALL_KEYS: KeyDef[] = [...PLAYER_ROW, ...MAIN_GRID, ...BOTTOM_ROW];

const CODE_MAP: Record<string, Key> = {
  KeyB: 'BUY',
  KeyS: 'SELL',
  KeyR: 'RENT',
  KeyG: 'GO',
  KeyO: 'OFFICE',
  KeyT: 'TRANSFER',
  Enter: 'ENTER',
  NumpadEnter: 'ENTER',
  Equal: 'ENTER',
  Escape: 'CLEAR',
  Backspace: 'CLEAR',
  Delete: 'CLEAR',
  ArrowLeft: 'PREV',
  ArrowRight: 'NEXT',
  ArrowUp: 'PREV',
  ArrowDown: 'NEXT',
};

/** Map a keyboard event to a calculator key (layout-independent: uses `code`). */
export function keyFromEvent(e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): Key | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const fn = /^F([1-6])$/.exec(e.code);
  if (fn) return `P${fn[1]}` as Key;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit) {
    if (e.shiftKey && e.code.startsWith('Digit')) {
      const n = Number(digit[1]);
      return n >= 1 && n <= 6 ? (`P${n}` as Key) : null;
    }
    return `D${digit[1]}` as Key;
  }
  return CODE_MAP[e.code] ?? null;
}
