import { useState } from 'react';
import type { KeyDef } from '../keymap';

export function KeyButton({
  def,
  onPress,
  disabled = false,
  flash = false,
}: {
  def: KeyDef;
  onPress: (def: KeyDef) => void;
  disabled?: boolean;
  /** Pressed state driven from the physical keyboard. */
  flash?: boolean;
}) {
  const [down, setDown] = useState(false);
  const pressed = down || flash;
  return (
    <button
      type="button"
      className={`calc-key calc-key-${def.kind} ${def.key} ${pressed ? 'is-down' : ''}`}
      disabled={disabled}
      aria-label={def.sub ?? def.label}
      title={`${def.sub ?? def.label} (${def.hint})`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setDown(true);
        onPress(def);
      }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onKeyDown={(e) => {
        // keyboard activation of a focused button (accessibility)
        if (e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onPress(def);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="calc-key-cap">
        <span className="calc-key-label">{def.label}</span>
      </span>
    </button>
  );
}
