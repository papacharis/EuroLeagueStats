import { BOTTOM_ROW, MAIN_GRID, PLAYER_ROW, type KeyDef } from '../keymap';
import type { Key } from '../engine/keypad';
import { KeyButton } from './Key';

export function Keypad({
  playerCount,
  onPress,
  flashKey,
  testMode,
}: {
  playerCount: number;
  onPress: (def: KeyDef) => void;
  flashKey: Key | null;
  testMode: boolean;
}) {
  return (
    <div className="keypad">
      <div className="keypad-players">
        {PLAYER_ROW.map((def, i) => (
          <KeyButton key={def.key} def={def} onPress={onPress} flash={flashKey === def.key} disabled={!testMode && i >= playerCount} />
        ))}
      </div>
      <div className="keypad-main">
        {MAIN_GRID.map((def) => (
          <KeyButton key={def.key} def={def} onPress={onPress} flash={flashKey === def.key} />
        ))}
      </div>
      <div className="keypad-bottom">
        {BOTTOM_ROW.map((def) => (
          <KeyButton key={def.key} def={def} onPress={onPress} flash={flashKey === def.key} />
        ))}
      </div>
    </div>
  );
}
