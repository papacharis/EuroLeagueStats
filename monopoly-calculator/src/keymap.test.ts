import { describe, expect, it } from 'vitest';
import { ALL_KEYS, keyFromEvent } from './keymap';

const ev = (code: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean }> = {}) => ({
  code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods,
});

describe('keyboard mapping', () => {
  it('digits, numpad and players', () => {
    expect(keyFromEvent(ev('Digit7'))).toBe('D7');
    expect(keyFromEvent(ev('Numpad0'))).toBe('D0');
    expect(keyFromEvent(ev('Digit3', { shiftKey: true }))).toBe('P3');
    expect(keyFromEvent(ev('Digit9', { shiftKey: true }))).toBeNull();
    expect(keyFromEvent(ev('F6'))).toBe('P6');
  });
  it('operations and control keys', () => {
    expect(keyFromEvent(ev('KeyB'))).toBe('BUY');
    expect(keyFromEvent(ev('Enter'))).toBe('ENTER');
    expect(keyFromEvent(ev('Escape'))).toBe('CLEAR');
    expect(keyFromEvent(ev('ArrowRight'))).toBe('NEXT');
    expect(keyFromEvent(ev('KeyZ', { ctrlKey: true }))).toBeNull();
  });
  it('every calculator key appears exactly once on the keypad', () => {
    const keys = ALL_KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(6 + 16 + 4);
  });
});
