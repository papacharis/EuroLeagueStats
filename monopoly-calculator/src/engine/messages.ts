import type { ErrorCode, GameEvent, GameState } from './game';

export type KeypadError = 'NEED_PLAYER' | 'NEED_COMPANY' | 'NEED_COUNT' | 'NEED_TARGET';

export const ERROR_TEXT: Record<ErrorCode | KeypadError, string> = {
  BAD_PLAYER: 'ΑΓΝΩΣΤΟΣ ΠΑΙΚΤΗΣ',
  BAD_COMPANY: 'ΕΤΑΙΡΙΑ 01-22',
  BAD_COUNT: 'ΛΑΘΟΣ ΠΟΣΟΤΗΤΑ',
  ALREADY_FLOATED: 'ΗΔΗ ΣΤΟ ΧΡΗΜΑΤΙΣΤΗΡΙΟ',
  NOT_FLOATED: 'ΔΕΝ ΕΧΕΙ ΕΙΣΑΧΘΕΙ',
  NOT_ENOUGH_AVAILABLE: 'ΔΕΝ ΥΠΑΡΧΟΥΝ ΜΕΤΟΧΕΣ',
  NOT_ENOUGH_OWNED: 'ΔΕΝ ΕΧΕΙΣ ΤΟΣΕΣ ΜΕΤΟΧΕΣ',
  SAME_PLAYER: 'ΙΔΙΟΣ ΠΑΙΚΤΗΣ',
  NO_MONOPOLY: 'ΧΩΡΙΣ ΜΟΝΟΠΩΛΙΟ',
  NO_RENT_DUE: 'ΔΕΝ ΟΦΕΙΛΕΤΑΙ ΕΝΟΙΚΙΟ',
  SIMULATION_ONLY: 'ΜΟΝΟ ΣΕ ΠΡΟΣΟΜΟΙΩΣΗ',
  NEED_PLAYER: 'ΠΑΤΗΣΤΕ ΠΑΙΚΤΗ',
  NEED_COMPANY: 'ΠΛΗΚΤΡΟΛΟΓΗΣΤΕ ΕΤΑΙΡΙΑ',
  NEED_COUNT: 'ΠΛΗΚΤΡΟΛΟΓΗΣΤΕ ΠΟΣΟΤΗΤΑ',
  NEED_TARGET: 'ΠΑΤΗΣΤΕ ΑΠΟΔΕΚΤΗ',
};

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function fmtMoney(n: number): string {
  return n.toLocaleString('el-GR');
}

/** Human-readable Greek description of a completed operation (history log). */
export function describeEvent(state: GameState, e: GameEvent): string {
  const name = (p: number) => state.playerNames[p] ?? `Παίκτης ${p + 1}`;
  const a = e.action;
  const pres = () =>
    e.presidentAfter !== undefined && e.presidentAfter !== e.presidentBefore
      ? e.presidentAfter === null
        ? ' · η εταιρία αποσύρθηκε'
        : ` · νέος πρόεδρος: ${name(e.presidentAfter)}`
      : '';
  switch (a.type) {
    case 'float':
      return `${name(a.player)} εισήγαγε την εταιρία ${pad2(a.company)} (5 μετοχές) — πληρώνει ${fmtMoney(e.amount)}`;
    case 'buy':
      return `${name(a.player)} αγόρασε ${a.count} μετοχ. ${pad2(a.company)} × ${fmtMoney(e.unitPrice!)} = ${fmtMoney(e.amount)}${pres()}`;
    case 'sell':
      return `${name(a.player)} πούλησε ${a.count} μετοχ. ${pad2(a.company)} × ${fmtMoney(e.unitPrice!)} = ${fmtMoney(e.amount)}${pres()}`;
    case 'transfer':
      return `${name(a.from)} μεταβίβασε ${a.count} μετοχ. ${pad2(a.company)} σε ${name(a.to)}${pres()}`;
    case 'rent': {
      const parts = (e.credited ?? [])
        .map((v, i) => (v > 0 ? `${name(i)} +${fmtMoney(v)}` : ''))
        .filter(Boolean)
        .join(', ');
      return `${name(a.player)} πληρώνει ενοίκιο ${fmtMoney(e.amount)} για ${pad2(a.company)} (${fmtMoney(e.unitPrice!)}/μετοχή) → μερίσματα: ${parts}`;
    }
    case 'go':
      return `${name(a.player)} πέρασε από την ΑΦΕΤΗΡΙΑ — εισπράττει μερίσματα ${fmtMoney(e.amount)}`;
    case 'buildings':
      return `Εταιρία ${pad2(a.company)}: ${a.count === 5 ? 'κεντρικό γραφείο' : `${a.count} γραφεία`}`;
    case 'cash':
      return `${name(a.player)}: διόρθωση μετρητών ${e.amount >= 0 ? '+' : ''}${fmtMoney(e.amount)}`;
  }
}
