# Monopoly Χρηματιστήριο – Ηλεκτρονικός Υπολογιστής (web)

This web app replaces the electronic calculator of **Monopoly Stock Exchange / Monopoly Χρηματιστήριο** (Hasbro 2001, by Reiner Knizia). It does not include the board game itself. You use it next to the physical board, with the game's paper money.

* The interface is in Greek. It runs on phones, tablets and desktop computers, in portrait or landscape.
* You can install it as an app (PWA), and it works offline.
* It saves the game on every move and restores it automatically.
* The share-price and rent calculations reproduce the tables read from a real unit. See [docs/RESEARCH.md](docs/RESEARCH.md).
* What each key and display state does is in [docs/SPEC.md](docs/SPEC.md), and that document marks what is verified and what is not.

> **Accuracy note.** The calculation logic is verified. The physical key layout and labels of the original unit are **not**, because no photo or scan was available. The keypad here is a reconstruction that follows the documented key order (pawn → company → action → quantity). If you send photos of the unit and the Greek rule-book pages, the keypad can be made to match exactly. Change `src/keymap.ts` and `src/engine/keypad.ts`.

## Running it

Requires Node.js 20 or newer.

```bash
cd monopoly-calculator
npm install
npm run dev        # development server → http://localhost:5173
npm test           # 65 automated tests (Vitest)
npm run build      # production build → dist/
npm run preview    # serve dist/ → http://localhost:4173
```

To try it on a phone during development, run `npm run dev -- --host` and open `http://<computer-ip>:5173` on the phone, on the same Wi-Fi network.

## Deploying it

`dist/` is a static site, and `base: './'` means it works from any sub-path. Copy it to any static host:

* **Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, base directory `monopoly-calculator`, publish directory `dist`.
* **GitHub Pages:** push the contents of `dist/` to a `gh-pages` branch, or use the `actions/deploy-pages` workflow.

Install and offline use need HTTPS (or localhost). Open the site once, then use "Add to Home screen" (Android/Chrome) or Share → "Add to Home Screen" (iPhone/Safari). After that the app works with no connection.

## Quick usage

| Move | Keys |
|---|---|
| Float a company (5 shares, president) | `Π1 0 9 ΑΓΟΡΑ =` |
| Buy / sell shares | `Π2 0 9 ΑΓΟΡΑ 2 =` · `Π2 0 9 ΠΩΛΗΣΗ 1 =` |
| Rent (player lands on a company) | `Π3 0 9 ΕΝΟΙΚΙΟ =` → pays the amount shown to the bank |
| Pass GO (collect dividends) | `Π1 ΑΦΕΤΗΡΙΑ =` → collects the amount shown from the bank |
| Offices (0–4, 5 = head office) | `0 9 ΓΡΑΦΕΙΑ 3 =` |
| Transfer shares | `Π1 0 9 ΜΕΤΑΒΙΒ. Π2 2 =` |
| View a company / player | `0 9 =`, `◄ ►`, `Π1 =` |

Keyboard: digits, Shift+1…6 or F1…F6 for players, B/S/R/G/O/T for buy/sell/rent/GO/offices/transfer, Enter, Esc, ←/→, Ctrl+Z. The full instructions are in the app under **«?»**.

## Code structure

```
src/engine/        pure game logic, no React (fully tested)
  data.ts          companies, colour groups, price/rent tables (moose)
  pricing.ts       share-price and rent formulas
  game.ts          game state, operations (float/buy/sell/rent/GO/offices/transfer), presidency, monopoly
  keypad.ts        key-sequence state machine
  display.ts       what the LCD shows (pure function)
  session.ts       app reducer: undo, history, new game
  storage.ts       localStorage save/load with validation
  messages.ts      Greek messages
src/components/    UI: Lcd, SevenSeg, Keypad, Key, panels, dialogs
src/keymap.ts      key layout and keyboard mapping (edit here for an exact layout)
```
