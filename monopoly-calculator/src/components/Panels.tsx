import { useState } from 'react';
import { COMPANIES, GROUP_COLORS } from '../engine/data';
import {
  centrePrice,
  currentPrice,
  isMonopoly,
  portfolioValue,
  sharesAvailable,
  totalShares,
  type GameState,
} from '../engine/game';
import { fmtMoney, pad2 } from '../engine/messages';
import type { LogEntry, Settings } from '../engine/storage';

export function companyLabel(n: number, settings: Settings): string {
  const custom = settings.companyNames[n - 1]?.trim();
  return custom || `Εταιρία ${pad2(n)}`;
}

// ───────────────────────── history ─────────────────────────

export function HistoryPanel({ log, canUndo, onUndo }: { log: LogEntry[]; canUndo: boolean; onUndo: () => void }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <span className="opacity-70">{log.length} κινήσεις</span>
        <button type="button" className="btn" disabled={!canUndo} onClick={onUndo}>
          ↶ Αναίρεση τελευταίας
        </button>
      </div>
      {log.length === 0 ? (
        <p className="opacity-70">Δεν υπάρχουν κινήσεις ακόμη.</p>
      ) : (
        <ol className="space-y-2">
          {[...log].reverse().map((l) => (
            <li key={l.id} className="rounded-lg bg-white/5 px-3 py-2">
              <div className="text-xs opacity-60">
                #{l.id} · {new Date(l.time).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div>{l.text}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ───────────────────────── overview board ─────────────────────────

export function OverviewPanel({
  game,
  settings,
  onCash,
  onRename,
}: {
  game: GameState;
  settings: Settings;
  onCash: (player: number, amount: number) => void;
  onRename: (player: number, name: string) => void;
}) {
  const players = Array.from({ length: game.playerCount }, (_, i) => i);
  return (
    <div className="space-y-4">
      <p className="text-xs opacity-70">
        Συνοπτικός πίνακας (πρόσθετη λειτουργία της εφαρμογής — η αυθεντική συσκευή δείχνει μία εταιρία κάθε φορά).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="p-1">Παίκτης</th>
              <th className="p-1 text-right">Μετοχές</th>
              <th className="p-1 text-right">Αξία χαρτοφ.</th>
              <th className="p-1 text-right">Μερίσματα</th>
              {game.cash && <th className="p-1 text-right">Μετρητά</th>}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <PlayerRow key={p} game={game} p={p} onCash={onCash} onRename={onRename} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="p-1">#</th>
              <th className="p-1">Εταιρία</th>
              <th className="p-1 text-right">Γρ.</th>
              <th className="p-1 text-right">Διαθ.</th>
              {players.map((p) => (
                <th key={p} className="p-1 text-right">
                  Π{p + 1}
                </th>
              ))}
              <th className="p-1 text-right">Τιμή</th>
            </tr>
          </thead>
          <tbody>
            {COMPANIES.map((c) => {
              const st = game.companies[c.number - 1];
              const price = currentPrice(game, c.number);
              return (
                <tr key={c.number} className="border-t border-white/5">
                  <td className="p-1">
                    <span className="inline-block w-2 h-3 mr-1 align-middle rounded-sm" style={{ background: GROUP_COLORS[c.group] }} />
                    {pad2(c.number)}
                  </td>
                  <td className="p-1 truncate max-w-[8rem]">
                    {companyLabel(c.number, settings)}
                    {isMonopoly(game, c.number) && <span title="Μονοπώλιο"> ★</span>}
                  </td>
                  <td className="p-1 text-right">{price === null ? '' : st.buildings === 5 ? 'Κ' : st.buildings}</td>
                  <td className="p-1 text-right">{sharesAvailable(game, c.number)}</td>
                  {players.map((p) => (
                    <td key={p} className={`p-1 text-right ${st.president === p ? 'font-bold underline' : ''}`}>
                      {st.shares[p] || ''}
                    </td>
                  ))}
                  <td className="p-1 text-right" title={price === null ? 'Αξία εισαγωγής' : `Κέντρο ${centrePrice(game, c.number)} ±6`}>
                    {price ?? <span className="opacity-50">{c.value}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs opacity-60 mt-1">Υπογράμμιση = πρόεδρος · ★ = μονοπώλιο · Κ = κεντρικό γραφείο · γκρι = αξία εισαγωγής</p>
      </div>
    </div>
  );
}

function PlayerRow({
  game,
  p,
  onCash,
  onRename,
}: {
  game: GameState;
  p: number;
  onCash: (player: number, amount: number) => void;
  onRename: (player: number, name: string) => void;
}) {
  const [adj, setAdj] = useState('');
  return (
    <tr className="border-t border-white/5 align-middle">
      <td className="p-1">
        <span className={`pawn pawn-${p + 1} mr-1`}>Π{p + 1}</span>
        <input
          className="input input-sm w-24"
          defaultValue={game.playerNames[p]}
          aria-label={`Όνομα παίκτη ${p + 1}`}
          onBlur={(e) => onRename(p, e.target.value)}
        />
      </td>
      <td className="p-1 text-right">{totalShares(game, p)}</td>
      <td className="p-1 text-right">{fmtMoney(portfolioValue(game, p))}</td>
      <td className="p-1 text-right">{fmtMoney(game.dividends[p])}</td>
      {game.cash && (
        <td className="p-1 text-right">
          <div className={game.cash[p] < 0 ? 'text-red-400' : ''}>{fmtMoney(game.cash[p])}</div>
          <form
            className="flex gap-1 justify-end mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              const v = parseInt(adj, 10);
              if (Number.isFinite(v) && v !== 0) onCash(p, v);
              setAdj('');
            }}
          >
            <input
              className="input input-sm w-16"
              inputMode="numeric"
              placeholder="±"
              value={adj}
              aria-label={`Διόρθωση μετρητών παίκτη ${p + 1}`}
              onChange={(e) => setAdj(e.target.value.replace(/[^\d-]/g, ''))}
            />
            <button className="btn btn-sm" type="submit">
              OK
            </button>
          </form>
        </td>
      )}
    </tr>
  );
}

// ───────────────────────── settings ─────────────────────────

export function SettingsPanel({
  settings,
  onChange,
  game,
  onNewGame,
  onTestMode,
  onEndGame,
}: {
  settings: Settings;
  onChange: (s: Partial<Settings>) => void;
  game: GameState | null;
  onNewGame: () => void;
  onTestMode: () => void;
  onEndGame: () => void;
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="font-semibold">Ήχος & δόνηση</h3>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.sound} onChange={(e) => onChange({ sound: e.target.checked })} />
          Ήχοι πλήκτρων
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.haptics} onChange={(e) => onChange({ haptics: e.target.checked })} />
          Δόνηση (κινητά)
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Ονόματα εταιριών</h3>
        <p className="text-xs opacity-70">
          Ο υπολογιστής χρησιμοποιεί μόνο αριθμούς 01–22. Συμπληρώστε τα ονόματα όπως είναι τυπωμένα στο δικό σας ταμπλό
          (δεν έχουν επιβεβαιωθεί τα ονόματα της ελληνικής έκδοσης). Στο πλαίσιο φαίνεται, για αναφορά, το όνομα της
          βρετανικής έκδοσης.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.showNames} onChange={(e) => onChange({ showNames: e.target.checked })} />
          Εμφάνιση ονόματος κάτω από την οθόνη
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {COMPANIES.map((c) => (
            <label key={c.number} className="flex items-center gap-2">
              <span className="inline-block w-2 h-4 rounded-sm" style={{ background: GROUP_COLORS[c.group] }} />
              <span className="w-6 tabular-nums">{pad2(c.number)}</span>
              <input
                className="input input-sm flex-1 min-w-0"
                value={settings.companyNames[c.number - 1]}
                placeholder={c.ukName}
                maxLength={28}
                onChange={(e) => {
                  const names = [...settings.companyNames];
                  names[c.number - 1] = e.target.value;
                  onChange({ companyNames: names });
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Εργαλεία</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={onTestMode}>
            Δοκιμή πλήκτρων / οθόνης
          </button>
          <button type="button" className="btn btn-danger" onClick={onNewGame}>
            Νέο παιχνίδι…
          </button>
          {game && (
            <button type="button" className="btn" onClick={onEndGame}>
              Τερματισμός (χωρίς νέο)
            </button>
          )}
        </div>
        {game && (
          <p className="text-xs opacity-70">
            Τρέχον παιχνίδι: {game.playerCount} παίκτες · λειτουργία{' '}
            {game.mode === 'original' ? 'Αυθεντική' : 'Προσομοίωση'} · {game.actionCount} κινήσεις
          </p>
        )}
      </section>
    </div>
  );
}
