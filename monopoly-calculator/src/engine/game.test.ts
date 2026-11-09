import { describe, expect, it } from 'vitest';
import {
  apply,
  centrePrice,
  currentPrice,
  isMonopoly,
  newGame,
  sharesAvailable,
  type Action,
  type GameState,
} from './game';

function run(state: GameState, ...actions: Action[]): GameState {
  for (const a of actions) {
    const r = apply(state, a);
    if (!r.ok) throw new Error(`${a.type} failed: ${r.error}`);
    state = r.state;
  }
  return state;
}

const g3 = () => newGame({ playerCount: 3, seed: 42, now: 0 });

describe('new game', () => {
  it('starts with all 9 shares available everywhere', () => {
    const g = g3();
    expect(g.companies.every((c) => c.shares.every((s) => s === 0))).toBe(true);
    expect(sharesAvailable(g, 7)).toBe(9);
    expect(currentPrice(g, 7)).toBeNull();
    expect(g.fluctuation).toBe(true);
  });
  it('rejects bad player counts', () => {
    expect(() => newGame({ playerCount: 1 })).toThrow();
    expect(() => newGame({ playerCount: 7 })).toThrow();
  });
  it('Original Mode always fluctuates and has no cash ledger', () => {
    const g = newGame({ playerCount: 2, mode: 'original', fluctuation: false });
    expect(g.fluctuation).toBe(true);
    expect(g.cash).toBeNull();
  });
});

describe('floating a company', () => {
  it('gives 5 shares and the presidency for the board value', () => {
    const r = apply(g3(), { type: 'float', player: 1, company: 22 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.amount).toBe(400);
    expect(r.state.companies[21]).toEqual({ shares: [0, 5, 0], buildings: 0, president: 1 });
    expect(sharesAvailable(r.state, 22)).toBe(4);
  });
  it('cannot float twice', () => {
    const g = run(g3(), { type: 'float', player: 0, company: 3 });
    expect(apply(g, { type: 'float', player: 1, company: 3 })).toEqual({ ok: false, error: 'ALREADY_FLOATED' });
  });
});

describe('buying and selling shares', () => {
  it('charges count × displayed price and updates availability', () => {
    let g = run(g3(), { type: 'float', player: 0, company: 22 });
    const price = currentPrice(g, 22)!;
    const r = apply(g, { type: 'buy', player: 1, company: 22, count: 2 });
    expect(r.ok && r.event.amount).toBe(price * 2);
    g = (r as { state: GameState }).state;
    expect(sharesAvailable(g, 22)).toBe(2);
  });
  it('cannot buy more than available or sell more than owned', () => {
    const g = run(g3(), { type: 'float', player: 0, company: 22 });
    expect(apply(g, { type: 'buy', player: 1, company: 22, count: 5 })).toEqual({ ok: false, error: 'NOT_ENOUGH_AVAILABLE' });
    expect(apply(g, { type: 'sell', player: 1, company: 22, count: 1 })).toEqual({ ok: false, error: 'NOT_ENOUGH_OWNED' });
    expect(apply(g3(), { type: 'buy', player: 1, company: 5, count: 1 })).toEqual({ ok: false, error: 'NOT_FLOATED' });
  });
  it('presidency passes to the largest holder; incumbent keeps a tie', () => {
    let g = run(g3(), { type: 'float', player: 0, company: 22 }, { type: 'buy', player: 1, company: 22, count: 4 });
    expect(g.companies[21].president).toBe(0);
    g = run(g, { type: 'sell', player: 0, company: 22, count: 1 }); // 4 vs 4 → tie, incumbent stays
    expect(g.companies[21].president).toBe(0);
    g = run(g, { type: 'transfer', from: 0, to: 2, company: 22, count: 1 }); // 3 vs 4
    expect(g.companies[21].president).toBe(1);
  });
  it('selling every share withdraws the company', () => {
    const g = run(g3(), { type: 'float', player: 0, company: 1 }, { type: 'sell', player: 0, company: 1, count: 5 });
    expect(g.companies[0]).toEqual({ shares: [0, 0, 0], buildings: 0, president: null });
  });
});

describe('monopoly and offices', () => {
  it('monopoly = same president on every company of the colour group', () => {
    let g = run(g3(), { type: 'float', player: 0, company: 21 });
    expect(isMonopoly(g, 21)).toBe(false);
    g = run(g, { type: 'float', player: 0, company: 22 });
    expect(isMonopoly(g, 21)).toBe(true);
    expect(isMonopoly(g, 22)).toBe(true);
  });
  it('offices need a monopoly', () => {
    const g = run(g3(), { type: 'float', player: 0, company: 21 });
    expect(apply(g, { type: 'buildings', company: 21, count: 1 })).toEqual({ ok: false, error: 'NO_MONOPOLY' });
    const g2 = run(g, { type: 'float', player: 0, company: 22 }, { type: 'buildings', company: 22, count: 5 });
    expect(g2.companies[21].buildings).toBe(5);
    expect(apply(g2, { type: 'buildings', company: 22, count: 6 })).toEqual({ ok: false, error: 'BAD_COUNT' });
  });
  it('reproduces the moose orange-group screen (stock left 4/0/2, prices 95/143/150)', () => {
    const g = run(
      newGame({ playerCount: 3, seed: 1 }),
      { type: 'float', player: 0, company: 9 },
      { type: 'float', player: 0, company: 10 },
      { type: 'float', player: 0, company: 11 },
      { type: 'buy', player: 1, company: 10, count: 3 },
      { type: 'buy', player: 2, company: 10, count: 1 },
      { type: 'buy', player: 1, company: 11, count: 2 },
      { type: 'buildings', company: 9, count: 2 },
      { type: 'buildings', company: 10, count: 2 },
      { type: 'buildings', company: 11, count: 3 },
    );
    expect([9, 10, 11].map((n) => sharesAvailable(g, n))).toEqual([4, 0, 2]);
    expect([9, 10, 11].map((n) => centrePrice(g, n))).toEqual([95, 143, 150]);
    for (const n of [9, 10, 11]) {
      const p = currentPrice(g, n)!;
      expect(Math.abs(p - centrePrice(g, n)!)).toBeLessThanOrEqual(6);
    }
  });
});

describe('rent and dividends', () => {
  it('payer pays rent; other holders are credited per share; GO pays out and resets', () => {
    let g = run(g3(), { type: 'float', player: 0, company: 22 }, { type: 'buy', player: 1, company: 22, count: 2 });
    // 7 sold, payer P3 holds 0 → perShare floor(8·100/56)=14 → 98
    const r = apply(g, { type: 'rent', player: 2, company: 22 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.amount).toBe(98);
    expect(r.event.credited).toEqual([70, 28, 0]);
    g = r.state;
    expect(g.dividends).toEqual([70, 28, 0]);
    const go = apply(g, { type: 'go', player: 0 });
    expect(go.ok && go.event.amount).toBe(70);
    expect(go.ok && go.state.dividends).toEqual([0, 28, 0]);
  });
  it('a shareholder paying rent is not credited for their own shares', () => {
    const g = run(g3(), { type: 'float', player: 0, company: 22 }, { type: 'buy', player: 1, company: 22, count: 2 });
    const r = apply(g, { type: 'rent', player: 1, company: 22 });
    // payer holds 2 of 7 → floor(6·100/56)=10 per share × 5 = 50
    expect(r.ok && r.event.amount).toBe(50);
    expect(r.ok && r.event.credited).toEqual([50, 0, 0]);
  });
  it('the president landing on their own sole-held company pays nothing', () => {
    const g = run(g3(), { type: 'float', player: 0, company: 22 });
    expect(apply(g, { type: 'rent', player: 0, company: 22 })).toEqual({ ok: false, error: 'NO_RENT_DUE' });
  });
});

describe('fluctuation', () => {
  it('is deterministic for a seed and stays within ±6', () => {
    const a = run(newGame({ playerCount: 2, seed: 7 }), { type: 'float', player: 0, company: 15 });
    const b = run(newGame({ playerCount: 2, seed: 7 }), { type: 'float', player: 0, company: 15 });
    expect(a.offsets).toEqual(b.offsets);
    let g = a;
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      g = run(g, { type: 'go', player: 0 });
      expect(Math.abs(g.offsets[14])).toBeLessThanOrEqual(6);
      seen.add(g.offsets[14]);
    }
    expect(seen.size).toBe(13); // every value −6‥+6 occurs
  });
  it('can be switched off in Simulation Mode only', () => {
    const g = run(newGame({ playerCount: 2, mode: 'simulation', fluctuation: false }), { type: 'float', player: 0, company: 22 });
    expect(currentPrice(g, 22)).toBe(87);
  });
});

describe('Simulation Mode cash ledger', () => {
  it('tracks cash for every money-moving operation', () => {
    let g = newGame({ playerCount: 2, mode: 'simulation', fluctuation: false, sim: { startCash: 1000, goSalary: 200 } });
    g = run(g, { type: 'float', player: 0, company: 22 }); // −400
    expect(g.cash).toEqual([600, 1000]);
    g = run(g, { type: 'rent', player: 1, company: 22 }); // 5 sold → 20/share → 100
    expect(g.cash).toEqual([600, 900]);
    g = run(g, { type: 'go', player: 0 }); // +100 dividend +200 salary
    expect(g.cash).toEqual([900, 900]);
    g = run(g, { type: 'cash', player: 1, amount: -50 });
    expect(g.cash).toEqual([900, 850]);
  });
  it('cash correction is refused in Original Mode', () => {
    expect(apply(g3(), { type: 'cash', player: 0, amount: 10 })).toEqual({ ok: false, error: 'SIMULATION_ONLY' });
  });
});
