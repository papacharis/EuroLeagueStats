import type { AmountKind, DisplayModel } from '../engine/display';
import { MAX_PLAYERS } from '../engine/data';
import { SevenSegField } from './SevenSeg';

const AMOUNT_LABELS: { kind: AmountKind; text: string }[] = [
  { kind: 'price', text: 'ΤΙΜΗ' },
  { kind: 'value', text: 'ΑΞΙΑ' },
  { kind: 'cost', text: 'ΠΛΗΡΩΝΕΙ' },
  { kind: 'proceeds', text: 'ΕΙΣΠΡΑΤΤΕΙ' },
  { kind: 'rent', text: 'ΕΝΟΙΚΙΟ' },
  { kind: 'dividend', text: 'ΜΕΡΙΣΜΑ' },
];

function Ann({ on, children, className = '' }: { on: boolean; children: React.ReactNode; className?: string }) {
  return <span className={`lcd-ann ${on ? 'lcd-ann-on' : ''} ${className}`}>{children}</span>;
}

export function Lcd({ d, testAll = false, powered = true }: { d: DisplayModel; testAll?: boolean; powered?: boolean }) {
  const all = testAll;
  const companyText = d.typingField === 'company' ? d.typing.padStart(2, '_') : d.company.toString().padStart(2, '0');
  const countText = d.typingField === 'count' ? d.typing : '';
  const amountText = d.error ? 'Err' : d.amount === null ? '' : String(d.amount);

  return (
    <div className={`lcd ${powered ? '' : 'lcd-off'} ${d.error ? 'lcd-error' : ''}`} aria-live="polite">
      <div className="lcd-text" data-testid="lcd-text">
        {all ? '█'.repeat(28) : d.text || ' '}
      </div>

      <div className="lcd-row lcd-row-main">
        <div className="lcd-cell">
          <Ann on={all || true}>ΕΤΑΙΡ.</Ann>
          <SevenSegField value={companyText} width={2} all={all} blink={d.typingField === 'company'} label={`Εταιρία ${companyText}`} />
        </div>
        <div className="lcd-cell">
          <Ann on>ΓΡΑΦ.</Ann>
          <SevenSegField value={d.buildings === null ? '' : String(d.buildings)} width={1} all={all} label={`Γραφεία ${d.buildings ?? 0}`} />
        </div>
        <div className="lcd-cell">
          <Ann on>ΔΙΑΘ.</Ann>
          <SevenSegField value={d.available === null ? '' : String(d.available)} width={1} all={all} label={`Διαθέσιμες ${d.available}`} />
        </div>
        <div className="lcd-cell">
          <Ann on={all || d.typingField === 'count'}>ΠΟΣ.</Ann>
          <SevenSegField value={countText} width={1} all={all} blink={d.typingField === 'count'} label={`Ποσότητα ${countText}`} />
        </div>
        <div className="lcd-cell lcd-amount">
          <div className="lcd-amount-labels">
            {AMOUNT_LABELS.map((l) => (
              <Ann key={l.kind} on={all || (d.amountKind === l.kind && d.amount !== null)}>
                {l.text}
              </Ann>
            ))}
          </div>
          <SevenSegField value={amountText} width={5} all={all} className="lcd-big" blink={d.error} label={`Ποσό ${amountText}`} />
        </div>
      </div>

      <div className="lcd-row lcd-row-players">
        {Array.from({ length: MAX_PLAYERS }, (_, i) => {
          const v = d.shares[i];
          const inGame = v !== null;
          return (
            <div key={i} className={`lcd-player ${inGame ? '' : 'lcd-player-out'}`}>
              <Ann on={all || d.activePlayer === i || d.targetPlayer === i} className="lcd-arrow">
                {d.targetPlayer === i ? '▼→' : '▼'}
              </Ann>
              <Ann on={all || inGame}>{`Π${i + 1}`}</Ann>
              <SevenSegField value={inGame ? String(v) : ''} width={1} all={all} label={`Παίκτης ${i + 1}: ${v ?? '-'} μετοχές`} />
              <Ann on={all || d.president === i}>ΠΡΟΕΔΡ.</Ann>
            </div>
          );
        })}
        <div className="lcd-flags">
          <Ann on={all || d.monopoly}>ΜΟΝΟΠΩΛΙΟ</Ann>
          <Ann on={all || d.done}>OK</Ann>
          <Ann on={all || d.error}>ΣΦΑΛΜΑ</Ann>
        </div>
      </div>
    </div>
  );
}
