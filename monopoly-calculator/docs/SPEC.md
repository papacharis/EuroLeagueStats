# Phase 2 – Functional specification

Status tags: **[V]** verified (see RESEARCH.md §3) · **[R]** reconstructed or assumed (RESEARCH.md §4) · **[A]** app-only addition, not part of the original device.

## Keys

| Key | Function | Status |
|---|---|---|
| Π1–Π6 | Select the player (pawn). Keys beyond the number of players are disabled. During a transfer this key picks the receiver. | [V] concept / [R] caps |
| 0–9 | During company entry, the last two digits typed are kept (01–22). During quantity entry, a single digit. | [V] / [R] |
| ΑΓΟΡΑ | Buy. On a company nobody owns yet, this floats it (5 shares, board value). | [V] |
| ΠΩΛΗΣΗ | Sell shares back to the bank at the displayed price | [V] op / [R] price |
| ΕΝΟΙΚΙΟ | Rent: shows what the landing player pays the bank and credits dividends to the holders | [V] |
| ΑΦΕΤΗΡΙΑ | GO: shows and pays out the player's accrued dividends, then resets them to 0 | [V] |
| ΓΡΑΦΕΙΑ | Set the building count 0–5 (5 = head office). 1 or more needs a monopoly. | [V] rule / [R] key |
| ΜΕΤΑΒΙΒ. | Transfer shares between players | [V] "exchange" / [R] key |
| = | Confirm the operation. Without an operation: show the typed company, or a player summary (`Π =`). | [R] |
| C | Clear the typed digits; a second press clears the whole entry | [R] |
| ◄ ► | Browse companies 01–22 | [R] |

## Sequences

```
float      Πp NN ΑΓΟΡΑ =
buy        Πp NN ΑΓΟΡΑ k =         (live cost preview while k is shown)
sell       Πp NN ΠΩΛΗΣΗ k =
rent       Πp NN ΕΝΟΙΚΙΟ =          (amount shown before =)
GO         Πp ΑΦΕΤΗΡΙΑ =
offices    NN ΓΡΑΦΕΙΑ k =           (k = new total 0–5)
transfer   Πp NN ΜΕΤΑΒΙΒ. Πq k =
view       NN =  |  ◄ ►  |  Πp =
```
Pressing another operation key mid-entry switches the operation and keeps the player and company.

## Display states

| State | Prompt line | Fields |
|---|---|---|
| Idle, company not floated | `NN ΧΩΡΙΣ ΜΕΤΟΧΟΥΣ` | available 9, amount = board value (ΑΞΙΑ) |
| Idle, floated | `NN ΠΡΟΕΔΡΟΣ Πx [ΜΟΝΟΠΩΛΙΟ]` | buildings, available, shares per player, ΤΙΜΗ = current price |
| Typing a company | `[Πp] ΕΤΑΙΡΙΑ _N` | company field blinks |
| Operation pending | e.g. `Π2 ΑΓΟΡΑ 09 ΠΟΣΕΣ;3` | ΠΟΣ. blinks; amount is a live preview (ΠΛΗΡΩΝΕΙ / ΕΙΣΠΡΑΤΤΕΙ / ΕΝΟΙΚΙΟ / ΜΕΡΙΣΜΑ) |
| Done | e.g. `Π3 ΠΛΗΡΩΝΕΙ ΕΝΟΙΚΙΟ ΣΤΗΝ ΤΡΑΠΕΖΑ` | OK annunciator, final amount |
| Error | `ΣΦΑΛΜΑ <reason>` | Err, ΣΦΑΛΜΑ annunciator, error beep; the game is unchanged |
| Player summary | `Πp ΜΕΡΙΣΜΑΤΑ · n ΜΕΤΟΧΕΣ` | ΜΕΡΙΣΜΑ = accrued dividends |

Errors: unknown player, company outside 01–22, already floated, not floated, not enough shares available or owned, quantity missing or wrong, transfer to the same player, no monopoly, no rent due.

## Modes

* **Original Mode** – only the device's behaviour. No cash; players use paper money. Fluctuation is always on.
* **Simulation Mode** [A] – also keeps a cash ledger per player (start cash and GO salary are configurable; defaults 1500 / 200 are classic Monopoly values and are not verified). Fluctuation can be switched off. Manual ± cash corrections are in the overview panel.

## App additions [A] (do not change the device logic)

History log (Greek) · Undo of the last 50 operations (Ctrl+Z) · overview table · optional sounds and vibration · fullscreen · Greek instructions · key and segment test mode · settings (sound, vibration, company names) · automatic save to and restore from localStorage · new game with confirmation · PWA that works offline · keyboard control.
