import { describe, expect, it } from 'vitest';
import { COMPANIES, OFFICE_RENT, PRICE_LOOKUP } from './data';
import { basePrice, effectiveBaseRent, priceFactor, priceLookup, rentQuote } from './pricing';

describe('static data (moose tables)', () => {
  it('has 22 companies numbered 01‥22 with board values', () => {
    expect(COMPANIES).toHaveLength(22);
    expect(COMPANIES[0]).toMatchObject({ number: 1, value: 60, baseRent: 4, group: 'brown' });
    expect(COMPANIES[21]).toMatchObject({ number: 22, value: 400, baseRent: 100, group: 'darkblue' });
  });
  it('every base rent has an office-rent row', () => {
    for (const c of COMPANIES) expect(OFFICE_RENT[c.baseRent]).toBeDefined();
  });
  it('lookup table is triangular (holders ≤ shares)', () => {
    PRICE_LOOKUP.forEach((row, p) => row.forEach((v, s) => expect(v === null).toBe(p > s)));
  });
});

describe('share price formula', () => {
  it('factor table', () => {
    expect(priceFactor(false, 0)).toBe(7);
    expect(priceFactor(true, 0)).toBe(12);
    expect([1, 2, 3, 4, 5].map((b) => priceFactor(true, b))).toEqual([14, 17, 20, 22, 28]);
  });
  it('lookup rejects impossible combinations', () => {
    expect(() => priceLookup(3, 2)).toThrow();
    expect(() => priceLookup(1, 0)).toThrow();
    expect(priceLookup(6, 9)).toBe(23);
  });
  // Worked example from the moose page (orange group).
  it('T.G.I. Friday\'s 09: 1 holder, 5 sold, 2 buildings → 95 (range 89‥101)', () => {
    expect(basePrice(9, 1, 5, true, 2)).toBe(95);
  });
  it('Pizza Hut 10: 3 holders, 9 sold, 2 buildings → 143 (range 137‥149)', () => {
    expect(basePrice(10, 3, 9, true, 2)).toBe(143);
  });
  it('Burger King 11: 2 holders, 7 sold, 3 buildings → 150 (range 144‥156)', () => {
    expect(basePrice(11, 2, 7, true, 3)).toBe(150);
  });
  it('fresh flotation of 01: 60/320·10·7 = 13.125 → 13', () => {
    expect(basePrice(1, 1, 5, false, 0)).toBe(13);
  });
  it('fresh flotation of 22: 400/320·10·7 = 87.5 → 87', () => {
    expect(basePrice(22, 1, 5, false, 0)).toBe(87);
  });
  it('more holders / fewer available shares raise the price, the split does not matter', () => {
    expect(basePrice(22, 2, 6, false, 0)).toBeGreaterThan(basePrice(22, 1, 6, false, 0));
    expect(basePrice(22, 2, 9, false, 0)).toBeGreaterThanOrEqual(basePrice(22, 2, 6, false, 0));
  });
});

describe('rent formula', () => {
  it('moose worked example: 09, monopoly, 1 office, 7 sold, payer holds 2 → 15 × 5 = 75', () => {
    const q = rentQuote(9, 2, 7, true, 1);
    expect(q).toEqual({ total: 75, perShare: 15, chargeableShares: 5, effectiveBase: 140 });
  });
  it('monopoly without offices doubles the base rent', () => {
    expect(effectiveBaseRent(22, false, 0)).toBe(100);
    expect(effectiveBaseRent(22, true, 0)).toBe(200);
  });
  it('offices use the hand-authored table (22: 1 office = base × 4)', () => {
    expect(effectiveBaseRent(22, true, 1)).toBe(400);
    expect(effectiveBaseRent(1, true, 5)).toBe(500);
    expect(effectiveBaseRent(9, true, 1)).toBe(140);
  });
  it('non-shareholder pays full rent on every sold share', () => {
    // 01: base 4, 5 sold, payer 0 → floor(8·4/40)=0 → clamped to 1 per share → 5
    expect(rentQuote(1, 0, 5, false, 0).total).toBe(5);
    // 22: base 100, 5 sold → floor(800/40)=20 per share → 100
    expect(rentQuote(22, 0, 5, false, 0).total).toBe(100);
  });
  it('owning shares lowers the rent; owning all sold shares means no rent', () => {
    const none = rentQuote(22, 0, 9, false, 0).total;
    const some = rentQuote(22, 3, 9, false, 0).total;
    expect(some).toBeLessThan(none);
    expect(rentQuote(22, 5, 5, false, 0).total).toBe(0);
  });
  it('per-share rent is never below 1', () => {
    expect(rentQuote(1, 7, 9, false, 0).perShare).toBe(1);
  });
});
