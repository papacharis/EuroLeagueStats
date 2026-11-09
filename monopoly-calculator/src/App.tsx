import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { company as companyDef, GROUP_COLORS } from './engine/data';
import { computeDisplay } from './engine/display';
import type { Key } from './engine/keypad';
import { appReducer, initialApp } from './engine/session';
import { loadSession, saveSession } from './engine/storage';
import { pad2 } from './engine/messages';
import { keyFromEvent, type KeyDef } from './keymap';
import { playFeedback, vibrate } from './hooks/feedback';
import { Lcd } from './components/Lcd';
import { Keypad } from './components/Keypad';
import { ConfirmDialog, Modal } from './components/Modal';
import { SetupForm } from './components/SetupScreen';
import { HistoryPanel, OverviewPanel, SettingsPanel, companyLabel } from './components/Panels';
import { HelpPanel } from './components/HelpPanel';

type Panel = null | 'history' | 'overview' | 'settings' | 'help' | 'newgame' | 'confirmNew' | 'confirmEnd';

export default function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, () => initialApp(loadSession()));
  const { session, keypad } = state;
  const game = session.game;
  const [panel, setPanel] = useState<Panel>(null);
  const [testMode, setTestMode] = useState(false);
  const [testKey, setTestKey] = useState<string>('');
  const [flashKey, setFlashKey] = useState<Key | null>(null);
  const [isFull, setIsFull] = useState(false);
  const settingsRef = useRef(session.settings);
  settingsRef.current = session.settings;

  // persist on every change
  useEffect(() => {
    saveSession(session);
  }, [session]);

  // sound / vibration feedback
  useEffect(() => {
    if (!state.feedback || state.tick === 0) return;
    if (settingsRef.current.sound) playFeedback(state.feedback);
    if (settingsRef.current.haptics) vibrate(state.feedback);
  }, [state.tick, state.feedback]);

  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const pressKey = useCallback(
    (key: Key) => {
      if (testMode) {
        setTestKey(key);
        if (settingsRef.current.sound) playFeedback('key');
        if (settingsRef.current.haptics) vibrate('key');
        return;
      }
      dispatch({ type: 'key', key });
    },
    [testMode],
  );

  const onKeyDef = useCallback((def: KeyDef) => pressKey(def.key), [pressKey]);

  // physical keyboard
  useEffect(() => {
    if (!game || panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        dispatch({ type: 'undo' });
        return;
      }
      const key = keyFromEvent(e);
      if (!key) return;
      e.preventDefault();
      if (e.repeat) return;
      setFlashKey(key);
      pressKey(key);
    };
    const onUp = () => setFlashKey(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [game, panel, pressKey]);

  const display = useMemo(() => (game ? computeDisplay(game, keypad) : null), [game, keypad]);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch {
      /* not supported (e.g. iPhone Safari) */
    }
  };

  const shownCompany = display ? companyDef(display.company) : null;

  return (
    <div className="app-shell">
      <header className="toolbar" role="toolbar" aria-label="Εργαλεία">
        <button type="button" className="tool-btn" onClick={() => dispatch({ type: 'undo' })} disabled={!game || session.undo.length === 0} title="Αναίρεση (Ctrl+Z)" aria-label="Αναίρεση">
          ↶<span className="tool-label">Αναίρεση</span>
        </button>
        <button type="button" className="tool-btn" onClick={() => setPanel('history')} disabled={!game} title="Ιστορικό" aria-label="Ιστορικό">
          ☰<span className="tool-label">Ιστορικό</span>
        </button>
        <button type="button" className="tool-btn" onClick={() => setPanel('overview')} disabled={!game} title="Πίνακας" aria-label="Πίνακας">
          ▦<span className="tool-label">Πίνακας</span>
        </button>
        <button type="button" className="tool-btn" onClick={() => setPanel('help')} title="Οδηγίες" aria-label="Οδηγίες">
          ?<span className="tool-label">Οδηγίες</span>
        </button>
        <button type="button" className="tool-btn" onClick={() => setPanel('settings')} title="Ρυθμίσεις" aria-label="Ρυθμίσεις">
          ⚙<span className="tool-label">Ρυθμίσεις</span>
        </button>
        <button type="button" className="tool-btn" onClick={toggleFullscreen} title="Πλήρης οθόνη" aria-label="Πλήρης οθόνη">
          {isFull ? '⤡' : '⤢'}
          <span className="tool-label">Οθόνη</span>
        </button>
      </header>

      <main className="device-wrap">
        {!game ? (
          <div className="panel rounded-2xl p-4 max-w-lg w-full">
            <h1 className="text-xl font-bold mb-1">Monopoly Χρηματιστήριο</h1>
            <p className="text-sm opacity-70 mb-4">Ηλεκτρονικός υπολογιστής — νέο παιχνίδι</p>
            <SetupForm onStart={(o) => dispatch({ type: 'newGame', options: o })} />
          </div>
        ) : (
          <div className={`device ${testMode ? 'device-test' : ''}`}>
            <div className="device-top">
              <div className="device-brand">
                <span className="brand-mono">MONOPOLY</span>
                <span className="brand-sub">ΧΡΗΜΑΤΙΣΤΗΡΙΟ</span>
              </div>
              {game.mode === 'simulation' && <span className="sim-badge">ΠΡΟΣΟΜΟΙΩΣΗ</span>}
            </div>

            <div className="device-screen-area">
              <Lcd d={display!} testAll={testMode} />
              {shownCompany && session.settings.showNames && !testMode && (
                <div className="company-strip">
                  <span className="company-swatch" style={{ background: GROUP_COLORS[shownCompany.group] }} />
                  <span className="truncate">
                    {pad2(shownCompany.number)} · {companyLabel(shownCompany.number, session.settings)}
                  </span>
                  <span className="ml-auto opacity-70 whitespace-nowrap">αξία {shownCompany.value}</span>
                </div>
              )}
              {testMode && (
                <div className="company-strip justify-between">
                  <span>
                    ΔΟΚΙΜΗ · πλήκτρο: <b>{testKey || '—'}</b>
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => { setTestMode(false); setTestKey(''); }}>
                    Έξοδος
                  </button>
                </div>
              )}
            </div>

            <Keypad playerCount={game.playerCount} onPress={onKeyDef} flashKey={flashKey} testMode={testMode} />
          </div>
        )}
      </main>

      {panel === 'help' && (
        <Modal title="Οδηγίες χρήσης" onClose={() => setPanel(null)} wide>
          <HelpPanel />
        </Modal>
      )}
      {panel === 'history' && game && (
        <Modal title="Ιστορικό κινήσεων" onClose={() => setPanel(null)}>
          <HistoryPanel log={session.log} canUndo={session.undo.length > 0} onUndo={() => dispatch({ type: 'undo' })} />
        </Modal>
      )}
      {panel === 'overview' && game && (
        <Modal title="Πίνακας κατάστασης" onClose={() => setPanel(null)} wide>
          <OverviewPanel
            game={game}
            settings={session.settings}
            onCash={(player, amount) => dispatch({ type: 'gameAction', action: { type: 'cash', player, amount } })}
            onRename={(player, name) => dispatch({ type: 'renamePlayer', player, name })}
          />
        </Modal>
      )}
      {panel === 'settings' && (
        <Modal title="Ρυθμίσεις" onClose={() => setPanel(null)} wide>
          <SettingsPanel
            settings={session.settings}
            game={game}
            onChange={(s) => dispatch({ type: 'settings', settings: s })}
            onNewGame={() => setPanel('confirmNew')}
            onEndGame={() => setPanel('confirmEnd')}
            onTestMode={() => {
              setTestMode(true);
              setPanel(null);
            }}
          />
        </Modal>
      )}
      {panel === 'confirmNew' && (
        <ConfirmDialog
          title="Νέο παιχνίδι;"
          message={game ? 'Το τρέχον παιχνίδι, το ιστορικό και οι αναιρέσεις θα διαγραφούν οριστικά.' : 'Ξεκινά νέο παιχνίδι.'}
          confirmText="Ναι, νέο παιχνίδι"
          danger
          onCancel={() => setPanel(null)}
          onConfirm={() => setPanel('newgame')}
        />
      )}
      {panel === 'confirmEnd' && (
        <ConfirmDialog
          title="Τερματισμός παιχνιδιού;"
          message="Το τρέχον παιχνίδι θα διαγραφεί οριστικά."
          confirmText="Τερματισμός"
          danger
          onCancel={() => setPanel(null)}
          onConfirm={() => {
            dispatch({ type: 'endGame' });
            setPanel(null);
          }}
        />
      )}
      {panel === 'newgame' && (
        <Modal title="Νέο παιχνίδι" onClose={() => setPanel(null)}>
          <SetupForm
            onCancel={() => setPanel(null)}
            onStart={(o) => {
              dispatch({ type: 'newGame', options: o });
              setPanel(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

