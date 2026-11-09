/** App-level pure reducer: keypad input + undo + history + persistence-ready session. */
import { apply, newGame, type Action, type GameEvent, type NewGameOptions } from './game';
import { initialKeypad, press, type Key, type KeypadState, type Feedback } from './keypad';
import { describeEvent } from './messages';
import { MAX_LOG, MAX_UNDO, type Session, type Settings } from './storage';

export interface AppState {
  session: Session;
  keypad: KeypadState;
  /** Feedback of the last key (drives sound / vibration). */
  feedback: Feedback | null;
  /** Increments on every key so effects can react even to identical feedback. */
  tick: number;
}

export type AppAction =
  | { type: 'key'; key: Key; now?: number }
  | { type: 'undo' }
  | { type: 'newGame'; options: NewGameOptions }
  | { type: 'endGame' }
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'gameAction'; action: Action; now?: number }
  | { type: 'renamePlayer'; player: number; name: string };

export function initialApp(session: Session): AppState {
  return { session, keypad: initialKeypad(), feedback: null, tick: 0 };
}

function record(state: AppState, before: Session['game'], after: NonNullable<Session['game']>, event: GameEvent, now: number): Session {
  const s = state.session;
  const id = (s.log.at(-1)?.id ?? 0) + 1;
  return {
    ...s,
    game: after,
    undo: [...s.undo, before!].slice(-MAX_UNDO),
    log: [...s.log, { id, time: now, text: describeEvent(after, event), actionCount: after.actionCount }].slice(-MAX_LOG),
  };
}

export function appReducer(state: AppState, a: AppAction): AppState {
  const s = state.session;
  switch (a.type) {
    case 'key': {
      if (!s.game) return state;
      const r = press(state.keypad, s.game, a.key);
      const session = r.event ? record(state, s.game, r.game, r.event, a.now ?? Date.now()) : s;
      return { session, keypad: r.keypad, feedback: r.feedback, tick: state.tick + 1 };
    }
    case 'gameAction': {
      if (!s.game) return state;
      const r = apply(s.game, a.action);
      if (!r.ok) return { ...state, feedback: 'error', tick: state.tick + 1 };
      return { ...state, session: record(state, s.game, r.state, r.event, a.now ?? Date.now()), feedback: 'ok', tick: state.tick + 1 };
    }
    case 'undo': {
      if (!s.game || s.undo.length === 0) return { ...state, feedback: 'error', tick: state.tick + 1 };
      const prev = s.undo[s.undo.length - 1];
      // every recorded operation pushed exactly one undo snapshot and one log line
      const log = s.log.slice(0, -1);
      return {
        session: { ...s, game: prev, undo: s.undo.slice(0, -1), log },
        keypad: { ...initialKeypad(), view: state.keypad.view },
        feedback: 'ok',
        tick: state.tick + 1,
      };
    }
    case 'newGame':
      return {
        session: { ...s, game: newGame(a.options), undo: [], log: [] },
        keypad: initialKeypad(),
        feedback: 'ok',
        tick: state.tick + 1,
      };
    case 'endGame':
      return { session: { ...s, game: null, undo: [], log: [] }, keypad: initialKeypad(), feedback: null, tick: state.tick + 1 };
    case 'settings':
      return { ...state, session: { ...s, settings: { ...s.settings, ...a.settings } } };
    case 'renamePlayer': {
      if (!s.game) return state;
      const names = [...s.game.playerNames];
      names[a.player] = a.name.trim() || names[a.player];
      return { ...state, session: { ...s, game: { ...s.game, playerNames: names } } };
    }
  }
}
