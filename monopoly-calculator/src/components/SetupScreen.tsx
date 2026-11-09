import { useState } from 'react';
import { DEFAULT_SIM, defaultPlayerName, type GameMode, type NewGameOptions } from '../engine/game';
import { MAX_PLAYERS, MIN_PLAYERS } from '../engine/data';

export function SetupForm({ onStart, onCancel }: { onStart: (o: NewGameOptions) => void; onCancel?: () => void }) {
  const [count, setCount] = useState(4);
  const [names, setNames] = useState<string[]>(Array(MAX_PLAYERS).fill(''));
  const [mode, setMode] = useState<GameMode>('original');
  const [startCash, setStartCash] = useState(DEFAULT_SIM.startCash);
  const [goSalary, setGoSalary] = useState(DEFAULT_SIM.goSalary);
  const [fluct, setFluct] = useState(true);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({
          playerCount: count,
          playerNames: names.slice(0, count),
          mode,
          sim: { startCash, goSalary },
          fluctuation: fluct,
        });
      }}
    >
      <fieldset>
        <legend className="font-semibold mb-2">Αριθμός παικτών</legend>
        <div className="flex gap-2">
          {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
            <button
              key={n}
              type="button"
              className={`btn flex-1 ${n === count ? 'btn-primary' : ''}`}
              aria-pressed={n === count}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="font-semibold mb-2 col-span-2">Ονόματα (προαιρετικά)</legend>
        {Array.from({ length: count }, (_, i) => (
          <label key={i} className="flex items-center gap-2">
            <span className={`pawn pawn-${i + 1}`}>Π{i + 1}</span>
            <input
              className="input flex-1 min-w-0"
              value={names[i]}
              placeholder={defaultPlayerName(i)}
              maxLength={16}
              onChange={(e) => setNames((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold mb-2">Λειτουργία</legend>
        <label className="flex gap-2 items-start">
          <input type="radio" name="mode" checked={mode === 'original'} onChange={() => setMode('original')} />
          <span>
            <b>Αυθεντική</b> — μόνο ό,τι κάνει ο υπολογιστής: μετοχές, τιμές, ενοίκια, μερίσματα, γραφεία. Τα χρήματα
            είναι τα χάρτινα χαρτονομίσματα του παιχνιδιού.
          </span>
        </label>
        <label className="flex gap-2 items-start">
          <input type="radio" name="mode" checked={mode === 'simulation'} onChange={() => setMode('simulation')} />
          <span>
            <b>Προσομοίωση</b> — επιπλέον ψηφιακό ταμείο για κάθε παίκτη (δεν υπάρχει στην αυθεντική συσκευή).
          </span>
        </label>
        {mode === 'simulation' && (
          <div className="grid grid-cols-2 gap-2 pl-6">
            <label className="flex flex-col gap-1">
              Αρχικά μετρητά
              <input className="input" type="number" inputMode="numeric" value={startCash} onChange={(e) => setStartCash(Number(e.target.value) || 0)} />
            </label>
            <label className="flex flex-col gap-1">
              Μισθός αφετηρίας
              <input className="input" type="number" inputMode="numeric" value={goSalary} onChange={(e) => setGoSalary(Number(e.target.value) || 0)} />
            </label>
            <label className="flex gap-2 items-center col-span-2">
              <input type="checkbox" checked={fluct} onChange={(e) => setFluct(e.target.checked)} />
              Διακύμανση τιμών ±6
            </label>
            <p className="col-span-2 text-xs opacity-70">
              Οι προεπιλογές 1500 / 200 είναι του κλασικού Monopoly και δεν έχουν επιβεβαιωθεί για αυτή την έκδοση.
            </p>
          </div>
        )}
      </fieldset>

      <div className="flex gap-2 justify-end pt-2">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Άκυρο
          </button>
        )}
        <button type="submit" className="btn btn-primary">
          Έναρξη παιχνιδιού
        </button>
      </div>
    </form>
  );
}
