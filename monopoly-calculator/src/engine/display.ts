/**
 * What the LCD shows for a given game + keypad state. Pure function → easy to test.
 *
 * Verified content of the default screen (moose project): company number, buildings,
 * shares still available, each player's shares and the current share price.
 * The text line (prompts) is an addition of this app – the original unit had no Greek text line.
 */
import { MAX_PLAYERS, company } from './data';
import { cstate, currentPrice, isFloated, isMonopoly, sharesAvailable, totalShares, type GameState } from './game';
import { entryAction, expectsCount, type KeypadState } from './keypad';
import { ERROR_TEXT, pad2 } from './messages';
import { apply } from './game';


export type AmountKind = 'price' | 'value' | 'cost' | 'proceeds' | 'rent' | 'dividend' | 'none';

export interface DisplayModel {
  company: number;
  buildings: number | null;
  available: number | null;
  /** Shares per player column (null = player not in game). */
  shares: (number | null)[];
  president: number | null;
  monopoly: boolean;
  amount: number | null;
  amountKind: AmountKind;
  /** Digits currently typed (shown blinking in the relevant field). */
  typing: string;
  typingField: 'company' | 'count' | null;
  activePlayer: number | null;
  targetPlayer: number | null;
  text: string;
  error: boolean;
  done: boolean;
}

const OP_TEXT: Record<string, string> = {
  BUY: 'ΑΓΟΡΑ',
  SELL: 'ΠΩΛΗΣΗ',
  RENT: 'ΕΝΟΙΚΙΟ',
  GO: 'ΑΦΕΤΗΡΙΑ',
  OFFICE: 'ΓΡΑΦΕΙΑ',
  TRANSFER: 'ΜΕΤΑΒΙΒΑΣΗ',
};

export function pLabel(p: number): string {
  return `Π${p + 1}`;
}

export function computeDisplay(game: GameState, kp: KeypadState): DisplayModel {
  const e = kp.entry;
  const typingCompany = e.op === null && e.digits !== '' ? parseInt(e.digits, 10) : null;
  let shown = e.company ?? kp.view;
  const resultCompany = kp.result && 'company' in kp.result.action ? kp.result.action.company : null;
  if (resultCompany) shown = resultCompany;

  const c = cstate(game, shown);
  const floated = isFloated(game, shown);
  const model: DisplayModel = {
    company: shown,
    buildings: floated ? c.buildings : null,
    available: sharesAvailable(game, shown),
    shares: Array.from({ length: MAX_PLAYERS }, (_, i) => (i < game.playerCount ? c.shares[i] : null)),
    president: c.president,
    monopoly: isMonopoly(game, shown),
    amount: floated ? currentPrice(game, shown) : company(shown).value,
    amountKind: floated ? 'price' : 'value',
    typing: e.digits,
    typingField: e.digits === '' ? null : e.op === null ? 'company' : 'count',
    activePlayer: e.player,
    targetPlayer: e.target,
    text: '',
    error: false,
    done: false,
  };

  if (!floated) {
    model.text = `${pad2(shown)} ΧΩΡΙΣ ΜΕΤΟΧΟΥΣ`;
  } else {
    model.text = `${pad2(shown)} ΠΡΟΕΔΡΟΣ ${pLabel(c.president!)}${model.monopoly ? ' ΜΟΝΟΠΩΛΙΟ' : ''}`;
  }

  // ── player summary
  if (kp.playerView !== null) {
    const p = kp.playerView;
    model.activePlayer = p;
    model.amount = game.dividends[p];
    model.amountKind = 'dividend';
    model.text = `${pLabel(p)} ΜΕΡΙΣΜΑΤΑ · ${totalShares(game, p)} ΜΕΤΟΧΕΣ`;
    return model;
  }

  // ── finished operation
  if (kp.result) {
    const a = kp.result.action;
    model.done = true;
    model.amount = kp.result.amount;
    switch (a.type) {
      case 'float':
        model.amountKind = 'cost';
        model.activePlayer = a.player;
        model.text = `${pLabel(a.player)} ΕΙΣΑΓΩΓΗ ${pad2(a.company)} ΠΛΗΡΩΝΕΙ`;
        break;
      case 'buy':
        model.amountKind = 'cost';
        model.activePlayer = a.player;
        model.text = `${pLabel(a.player)} ΑΓΟΡΑ ${a.count} ΠΛΗΡΩΝΕΙ`;
        break;
      case 'sell':
        model.amountKind = 'proceeds';
        model.activePlayer = a.player;
        model.text = `${pLabel(a.player)} ΠΩΛΗΣΗ ${a.count} ΕΙΣΠΡΑΤΤΕΙ`;
        break;
      case 'rent':
        model.amountKind = 'rent';
        model.activePlayer = a.player;
        model.text = `${pLabel(a.player)} ΠΛΗΡΩΝΕΙ ΕΝΟΙΚΙΟ ΣΤΗΝ ΤΡΑΠΕΖΑ`;
        break;
      case 'go':
        model.amountKind = 'dividend';
        model.activePlayer = a.player;
        model.text = `${pLabel(a.player)} ΕΙΣΠΡΑΤΤΕΙ ΜΕΡΙΣΜΑΤΑ`;
        break;
      case 'transfer':
        model.amountKind = 'none';
        model.amount = null;
        model.activePlayer = a.from;
        model.targetPlayer = a.to;
        model.text = `${pLabel(a.from)}→${pLabel(a.to)} ${a.count} ΜΕΤΟΧΕΣ OK`;
        break;
      case 'buildings':
        model.amountKind = 'none';
        model.amount = null;
        model.text = `${pad2(a.company)} ${a.count === 5 ? 'ΚΕΝΤΡ. ΓΡΑΦΕΙΟ' : `${a.count} ΓΡΑΦΕΙΑ`} OK`;
        break;
      case 'cash':
        break;
    }
    return model;
  }

  // ── entry in progress
  if (typingCompany !== null) {
    model.text = `${e.player !== null ? pLabel(e.player) + ' ' : ''}ΕΤΑΙΡΙΑ ${e.digits.padStart(2, '_')}`;
  } else if (e.op !== null) {
    const who = e.player !== null ? pLabel(e.player) + ' ' : '';
    const co = e.company !== null ? ` ${pad2(e.company)}` : '';
    let tail = '';
    if (e.op === 'BUY' && e.company !== null && !isFloated(game, e.company)) tail = ' ΕΙΣΑΓΩΓΗ 5 =';
    else if (e.op === 'TRANSFER' && e.target === null) tail = ' ΣΕ ΠΑΙΚΤΗ;';
    else if (e.op === 'TRANSFER') tail = ` ΣΕ ${pLabel(e.target!)} ΠΟΣΕΣ;${e.digits}`;
    else if (e.op === 'OFFICE') tail = ` ΣΥΝΟΛΟ;${e.digits}`;
    else if (expectsCount(game, e)) tail = ` ΠΟΣΕΣ;${e.digits}`;
    else tail = ' =';
    model.text = `${who}${OP_TEXT[e.op]}${co}${tail}`;

    // live preview of the amount
    const built = entryAction(game, e);
    if ('action' in built) {
      const q = apply(game, built.action);
      if (q.ok) {
        model.amount = q.event.amount;
        model.amountKind =
          built.action.type === 'sell'
            ? 'proceeds'
            : built.action.type === 'rent'
              ? 'rent'
              : built.action.type === 'go'
                ? 'dividend'
                : built.action.type === 'float' || built.action.type === 'buy'
                  ? 'cost'
                  : model.amountKind;
        if (built.action.type === 'transfer' || built.action.type === 'buildings') {
          model.amount = currentPrice(game, shown);
          model.amountKind = 'price';
        }
      }
    } else if (e.op === 'GO' && e.player !== null) {
      model.amount = game.dividends[e.player];
      model.amountKind = 'dividend';
    }
  } else if (e.player !== null) {
    model.text = `${pLabel(e.player)} ΕΤΑΙΡΙΑ;`;
  }

  if (kp.error) {
    model.error = true;
    model.text = `ΣΦΑΛΜΑ ${ERROR_TEXT[kp.error]}`;
  }
  return model;
}
