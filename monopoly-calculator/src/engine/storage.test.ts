import { describe, expect, it } from 'vitest';
import { apply, newGame } from './game';
import { appReducer, initialApp } from './session';
import { STORAGE_KEY, deserialize, emptySession, isValidGame, loadSession, saveSession, serialize } from './storage';

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('save / restore', () => {
  it('round-trips a session through storage', () => {
    let st = initialApp(emptySession());
    st = appReducer(st, { type: 'newGame', options: { playerCount: 3, seed: 9 } });
    for (const key of ['P1', 'D2', 'D2', 'BUY', 'ENTER'] as const) st = appReducer(st, { type: 'key', key, now: 1 });
    const mem = new MemStorage();
    expect(saveSession(st.session, mem)).toBe(true);
    const restored = loadSession(mem);
    expect(restored).toEqual(st.session);
    expect(restored.game!.companies[21].shares).toEqual([5, 0, 0]);
    expect(restored.log).toHaveLength(1);
  });
  it('ignores corrupted or foreign data', () => {
    expect(deserialize('{not json').game).toBeNull();
    expect(deserialize(JSON.stringify({ game: { version: 99 } })).game).toBeNull();
    const g = newGame({ playerCount: 2 });
    const bad = { ...g, companies: g.companies.map((c) => ({ ...c, shares: [9, 9] })) };
    expect(isValidGame(bad)).toBe(false);
    expect(isValidGame(g)).toBe(true);
  });
  it('falls back to defaults for missing settings', () => {
    const s = deserialize(JSON.stringify({ settings: { sound: false } }));
    expect(s.settings.sound).toBe(false);
    expect(s.settings.haptics).toBe(true);
    expect(s.settings.companyNames).toHaveLength(22);
  });
  it('survives a throwing storage', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadSession(throwing).game).toBeNull();
    expect(saveSession(emptySession(), throwing)).toBe(false);
  });
  it('uses a versioned key', () => {
    expect(STORAGE_KEY).toMatch(/v1$/);
    expect(JSON.parse(serialize(emptySession())).game).toBeNull();
  });
});

describe('session: undo and history', () => {
  it('undo restores the previous state and removes the log line', () => {
    let st = appReducer(initialApp(emptySession()), { type: 'newGame', options: { playerCount: 2, seed: 1 } });
    const start = st.session.game!;
    for (const key of ['P1', 'D0', 'D1', 'BUY', 'ENTER'] as const) st = appReducer(st, { type: 'key', key });
    expect(st.session.log).toHaveLength(1);
    expect(st.session.undo).toHaveLength(1);
    st = appReducer(st, { type: 'undo' });
    expect(st.session.game).toEqual(start);
    expect(st.session.log).toHaveLength(0);
    st = appReducer(st, { type: 'undo' });
    expect(st.feedback).toBe('error');
  });
  it('failed operations do not create undo entries', () => {
    let st = appReducer(initialApp(emptySession()), { type: 'newGame', options: { playerCount: 2 } });
    for (const key of ['P1', 'D0', 'D1', 'SELL', 'D1', 'ENTER'] as const) st = appReducer(st, { type: 'key', key });
    expect(st.session.undo).toHaveLength(0);
    expect(st.feedback).toBe('error');
  });
  it('new game wipes history; end game clears the game', () => {
    let st = appReducer(initialApp(emptySession()), { type: 'newGame', options: { playerCount: 2 } });
    st = appReducer(st, { type: 'gameAction', action: { type: 'float', player: 0, company: 1 } });
    expect(st.session.log).toHaveLength(1);
    st = appReducer(st, { type: 'newGame', options: { playerCount: 4 } });
    expect(st.session.log).toHaveLength(0);
    expect(st.session.game!.playerCount).toBe(4);
    st = appReducer(st, { type: 'endGame' });
    expect(st.session.game).toBeNull();
  });
  it('log lines are Greek descriptions', () => {
    const g = newGame({ playerCount: 2, playerNames: ['Άννα', 'Νίκος'] });
    let st = appReducer(initialApp({ ...emptySession(), game: g }), { type: 'gameAction', action: { type: 'float', player: 0, company: 9 } });
    expect(st.session.log[0].text).toContain('Άννα');
    expect(st.session.log[0].text).toContain('09');
    const r = apply(st.session.game!, { type: 'rent', player: 1, company: 9 });
    expect(r.ok).toBe(true);
    st = appReducer(st, { type: 'gameAction', action: { type: 'rent', player: 1, company: 9 } });
    expect(st.session.log[1].text).toContain('ενοίκιο');
  });
});
