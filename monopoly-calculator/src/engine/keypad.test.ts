import { describe, expect, it } from 'vitest';
import { newGame, sharesAvailable, type GameState } from './game';
import { initialKeypad, parseSequence, pressAll, type KeypadState } from './keypad';
import { computeDisplay } from './display';

function seq(game: GameState, s: string, kp: KeypadState = initialKeypad()) {
  return pressAll(kp, game, parseSequence(s));
}
const g = () => newGame({ playerCount: 4, seed: 3 });

describe('parseSequence', () => {
  it('splits numbers into digit keys', () => {
    expect(parseSequence('P1 09 BUY 2 =')).toEqual(['P1', 'D0', 'D9', 'BUY', 'D2', 'ENTER']);
    expect(parseSequence('C NEXT')).toEqual(['CLEAR', 'NEXT']);
  });
});

describe('calculator key sequences', () => {
  it('P1 22 ΑΓΟΡΑ = floats the company for player 1', () => {
    const r = seq(g(), 'P1 22 BUY =');
    expect(r.events).toHaveLength(1);
    expect(r.events[0].action).toEqual({ type: 'float', player: 0, company: 22 });
    expect(r.events[0].amount).toBe(400);
    expect(r.game.companies[21].shares).toEqual([5, 0, 0, 0]);
    expect(r.feedback).toBe('ok');
  });
  it('buy, sell, rent, GO, transfer, offices', () => {
    let r = seq(g(), 'P1 21 BUY = P1 22 BUY = P2 22 BUY 3 =');
    expect(r.game.companies[21].shares).toEqual([5, 3, 0, 0]);
    r = seq(r.game, 'P2 22 SELL 1 =', r.keypad);
    expect(r.game.companies[21].shares).toEqual([5, 2, 0, 0]);
    r = seq(r.game, 'P3 22 RENT =', r.keypad);
    expect(r.events[0].action.type).toBe('rent');
    expect(r.game.dividends[0]).toBeGreaterThan(0);
    const div = r.game.dividends[0];
    r = seq(r.game, 'P1 GO =', r.keypad);
    expect(r.events[0].amount).toBe(div);
    expect(r.game.dividends[0]).toBe(0);
    r = seq(r.game, 'P2 22 TRANSFER P4 2 =', r.keypad);
    expect(r.game.companies[21].shares).toEqual([5, 0, 0, 2]);
    r = seq(r.game, '22 OFFICE 3 =', r.keypad);
    expect(r.game.companies[21].buildings).toBe(3);
    r = seq(r.game, '22 OFFICE 0 =', r.keypad);
    expect(r.game.companies[21].buildings).toBe(0);
  });
  it('errors: missing player, bad company, missing quantity, not enough shares', () => {
    expect(seq(g(), '05 BUY').keypad.error).toBe('NEED_PLAYER');
    expect(seq(g(), 'P1 33 BUY').keypad.error).toBe('BAD_COMPANY');
    expect(seq(g(), 'P1 00 BUY').keypad.error).toBe('BAD_COMPANY');
    const floated = seq(g(), 'P1 05 BUY =').game;
    expect(seq(floated, 'P2 05 BUY =').keypad.error).toBe('NEED_COUNT');
    const r = seq(floated, 'P2 05 BUY 5 =');
    expect(r.keypad.error).toBe('NOT_ENOUGH_AVAILABLE');
    expect(r.feedback).toBe('error');
    expect(sharesAvailable(r.game, 5)).toBe(4);
  });
  it('player keys beyond the number of players are rejected', () => {
    expect(seq(g(), 'P5').keypad.error).toBe('BAD_PLAYER');
  });
  it('transfer to the same player is rejected', () => {
    const fl = seq(g(), 'P1 05 BUY =').game;
    expect(seq(fl, 'P1 05 TRANSFER P1').keypad.error).toBe('SAME_PLAYER');
  });
  it('company number keeps the last two digits typed', () => {
    expect(seq(g(), '1 2 3 =').keypad.error).toBe('BAD_COMPANY'); // "23" is not a company
    expect(seq(g(), '1 2 =').keypad.view).toBe(12);
    expect(seq(g(), '4 0 7 =').keypad.view).toBe(7);
  });
  it('C clears the typed digits first, then the whole entry', () => {
    let r = seq(g(), 'P1 0 9');
    r = seq(r.game, 'C', r.keypad);
    expect(r.keypad.entry).toMatchObject({ player: 0, digits: '' });
    r = seq(r.game, 'C', r.keypad);
    expect(r.keypad.entry.player).toBeNull();
  });
  it('◄ ► browse the companies with wrap-around', () => {
    expect(seq(g(), 'PREV').keypad.view).toBe(22);
    expect(seq(g(), 'NEXT NEXT').keypad.view).toBe(3);
  });
  it('switching operation keeps player and company', () => {
    const fl = seq(g(), 'P1 05 BUY =').game;
    const r = seq(fl, 'P1 05 BUY 2 SELL 1 =');
    expect(r.events[0].action).toEqual({ type: 'sell', player: 0, company: 5, count: 1 });
  });
});

describe('LCD display model', () => {
  it('idle view shows company, availability, shares per player and value', () => {
    const d = computeDisplay(g(), initialKeypad());
    expect(d).toMatchObject({ company: 1, available: 9, amount: 60, amountKind: 'value', shares: [0, 0, 0, 0, null, null] });
  });
  it('shows a live cost preview while typing the quantity', () => {
    const fl = seq(g(), 'P1 05 BUY =').game;
    const r = seq(fl, 'P2 05 BUY 3');
    const d = computeDisplay(r.game, r.keypad);
    expect(d.amountKind).toBe('cost');
    expect(d.amount).toBeGreaterThan(0);
    expect(d.typingField).toBe('count');
    expect(d.activePlayer).toBe(1);
  });
  it('shows the result after ENTER and the error text on errors', () => {
    const r = seq(g(), 'P1 05 BUY =');
    expect(computeDisplay(r.game, r.keypad)).toMatchObject({ done: true, amount: 120, amountKind: 'cost' });
    const e = seq(g(), 'P1 44 BUY');
    expect(computeDisplay(e.game, e.keypad)).toMatchObject({ error: true });
    expect(computeDisplay(e.game, e.keypad).text).toContain('ΣΦΑΛΜΑ');
  });
  it('player summary (P = ) shows accrued dividends', () => {
    const r = seq(g(), 'P2 =');
    expect(computeDisplay(r.game, r.keypad)).toMatchObject({ amountKind: 'dividend', amount: 0, activePlayer: 1 });
  });
});
