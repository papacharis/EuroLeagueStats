import {
  FACTOR_BUILDINGS,
  FACTOR_MONOPOLY,
  FACTOR_NO_MONOPOLY,
  MAX_BUILDINGS,
  OFFICE_RENT,
  PRICE_DIVISOR,
  PRICE_LOOKUP,
  SHARES_PER_COMPANY,
  company,
} from './data';

/** Factor from the monopoly/buildings table. */
export function priceFactor(monopoly: boolean, buildings: number): number {
  if (buildings < 0 || buildings > MAX_BUILDINGS) throw new RangeError(`buildings ${buildings}`);
  if (buildings > 0) return FACTOR_BUILDINGS[buildings];
  return monopoly ? FACTOR_MONOPOLY : FACTOR_NO_MONOPOLY;
}

/** lookupValue from the players × shares-sold table. */
export function priceLookup(holders: number, sharesSold: number): number {
  if (sharesSold < 1 || sharesSold > SHARES_PER_COMPANY) throw new RangeError(`sharesSold ${sharesSold}`);
  if (holders < 1 || holders > PRICE_LOOKUP.length || holders > sharesSold) {
    throw new RangeError(`holders ${holders} with ${sharesSold} shares`);
  }
  const v = PRICE_LOOKUP[holders - 1][sharesSold - 1];
  if (v == null) throw new RangeError(`impossible combination ${holders}/${sharesSold}`);
  return v;
}

/**
 * Centre value of the share price:
 * floor(round((value / 320) * lookupValue * factor, 2))
 */
export function basePrice(
  companyNumber: number,
  holders: number,
  sharesSold: number,
  monopoly: boolean,
  buildings: number,
): number {
  const raw = (company(companyNumber).value / PRICE_DIVISOR) * priceLookup(holders, sharesSold) * priceFactor(monopoly, buildings);
  const rounded2 = Math.round(raw * 100) / 100;
  return Math.floor(rounded2);
}

/** Effective base rent after monopoly doubling or the office table. */
export function effectiveBaseRent(companyNumber: number, monopoly: boolean, buildings: number): number {
  const base = company(companyNumber).baseRent;
  if (buildings > 0) {
    const row = OFFICE_RENT[base];
    if (!row) throw new Error(`no office rent row for base ${base}`);
    return row[buildings - 1];
  }
  return monopoly ? base * 2 : base;
}

/** Rent payable per share not owned by the payer. */
export function rentPerShare(effectiveBase: number, payerShares: number, sharesSold: number): number {
  if (sharesSold <= 0) return 0;
  return Math.max(Math.floor(((8 - payerShares) * effectiveBase) / (8 * sharesSold)), 1);
}

export interface RentQuote {
  /** Total rent the landing player pays. */
  total: number;
  /** Rent per share held by somebody else. */
  perShare: number;
  /** Number of sold shares the payer does not own. */
  chargeableShares: number;
  effectiveBase: number;
}

export function rentQuote(
  companyNumber: number,
  payerShares: number,
  sharesSold: number,
  monopoly: boolean,
  buildings: number,
): RentQuote {
  const effectiveBase = effectiveBaseRent(companyNumber, monopoly, buildings);
  const chargeableShares = Math.max(sharesSold - payerShares, 0);
  if (chargeableShares === 0) return { total: 0, perShare: 0, chargeableShares, effectiveBase };
  const perShare = rentPerShare(effectiveBase, payerShares, sharesSold);
  return { total: perShare * chargeableShares, perShare, chargeableShares, effectiveBase };
}
