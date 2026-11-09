# Phase 1 – Research: the Monopoly Stock Exchange electronic unit

## 1. Which game

| | |
|---|---|
| International title | **Monopoly – Stock Exchange** (also "Monopoly Stock Exchange Edition") |
| Greek title | **Monopoly Χρηματιστήριο** |
| Other localisations | DE *Monopoly – Die Börse* (Parker 16465), NL/BE *Monopoly Beurs Editie* |
| Year / publisher | 2001, Hasbro (Parker / Waddingtons) |
| Designer | Reiner Knizia |
| Players | 2–6 |
| Electronic part | A hand-held "electronic broker" / stock-exchange computer. It tracks shares, presidents, offices, rent and dividends. |

It was not released in the US. Do not confuse it with the 1936 or 1992 *Stock Exchange add-on*, which had no electronics and different rules.

**Not verified:** I could not find a listing, scan or photo of the Greek box. I'm assuming the Greek edition uses the same unit and rules as the other 2001 localisations, because those were all one product. Company names were localised per country (the UK edition used Gillette … BT, the Benelux edition used Benelux companies), so the Greek names are unknown. The unit only works with numbers 01–22, so the app shows numbers and lets you type your own names.

## 2. Sources and how much to trust them

| # | Source | What it gave | Reliability |
|---|---|---|---|
| S1 | **moose – "Unraveling the Monopoly Stock Exchange Computer"** (github.com/warendorff/moose, last update June 2026) | Company values, base rents, the full **share-price formula and lookup tables**, the **rent formula**, the **office-rent table**, the ±6 fluctuation, what the default screen shows, and two worked examples | High for the numbers: the tables were read out of a real unit and fitted to formulas that reproduce them exactly. Prose descriptions are secondary. |
| S2 | MSE-Compute-Emulator (github.com/wietsewarendorff/MSE-Compute-Emulator, 2016) | Colour groups, company order, the idea that rent income is paid at GO | Low. Its price and rent maths are guesses that S1 later replaced. Used only to cross-check the colour groups. |
| S3 | Dutch rule book *Spelregels Monopoly Beurs Editie* (spelregels.eu / yumpu, search snippets only) | The rule book has an "overview of the game and the buttons" section. Key sequences are *pawn → company number (2 digits) → action → quantity*. There are separate sequences for paying rent to the bank and for collecting dividend, which starts with the *start* (GO) key. | Medium. Only fragments could be read (see §5). |
| S4 | SpellenLab, spelmagazijn, reich-der-spiele, spieletest.at, BoardGameGeek, Dice Tower, Rich Uncle Pennybags (search summaries) | 9 shares per company. The first player on a company may float it by buying 5 shares at the board price and becomes president. A simple majority keeps the presidency. A monopoly is all companies of a colour under one president, and only then can offices or a head office be bought (32 offices, 12 head offices in the box). Dividends are paid at GO. "Bull" and "Bear" cards replace Chance and Community Chest. | Medium. The sources agree with each other. |

## 3. Verified mechanics (implemented in Original Mode)

1. **22 companies** numbered 01–22, in the 8 classic colour groups (2-3-3-3-3-3-3-2). Values: 60 60 100 100 120 140 140 160 180 180 200 220 220 240 260 260 280 300 300 320 350 400 (S1, S4).
2. **9 shares per company.** Floating a company gives the floating player **5 shares** at the board value and makes them **president** (S1, S3, S4).
3. **Share price** (S1):
   `floor(round(value/320 × lookup[holders][sharesSold] × factor, 2))`, where factor is 7 without a monopoly, 12 with one, and 14/17/20/22/28 for 1–5 buildings. The displayed price **fluctuates within ±6** of that value. The split of shares between players does not matter, only the number of holders and the total sold.
4. **Rent** (S1): `perShare = max(floor((8 − payerShares) × base / (8 × sold)), 1)`, `rent = perShare × (sold − payerShares)`. The base rent is doubled with a monopoly and no offices. With 1–5 offices it comes from the office table.
5. **Rent goes to the bank and is collected as dividend at GO** (S1, S3, S4).
6. **Monopoly = same president on the whole colour group**. Offices (max 4 + head office) need a monopoly (S1, S4).
7. **Default screen:** company number, buildings, shares available, each player's shares, current share price (S1).
8. **Key order:** pawn → company number → action → quantity (S3).

All worked examples in S1 are reproduced by automated tests (`src/engine/pricing.test.ts`, `game.test.ts`): prices 95 / 143 / 150 for the orange group and a rent of 75.

## 4. Inferred, unverified, or unknown (the app's choice is marked)

| Topic | Status | What the app does |
|---|---|---|
| Physical key layout, key caps, colours | **Unknown**: no readable photo or scan | Reconstructed keypad: Π1–Π6, 0–9, ΑΓΟΡΑ, ΠΩΛΗΣΗ, ΕΝΟΙΚΙΟ, ΑΦΕΤΗΡΙΑ, ΓΡΑΦΕΙΑ, ΜΕΤΑΒΙΒ., C, =, ◄ ►. It follows the documented key order. Edit `src/keymap.ts` once photos are available. |
| LCD layout / segments | Content verified, layout unknown | Seven-segment fields for the verified content, plus a Greek prompt line that the original does not have. |
| How dividends are split | Inferred: S1 says rent is always a multiple of the payer's non-owned shares | Each other holder is credited `perShare × their shares`. The credits add up exactly to the rent. |
| When the ±6 fluctuation changes | Unknown | A new random offset after every completed operation, stored in the game so it survives undo and reload. |
| Selling price | Unknown (the emulator's fee is invented) | Sells at the currently displayed price. |
| Buying several shares | Unknown whether the price is recalculated per share | `count ×` the price shown before the purchase. |
| Presidency on a tie / below 5 shares | Partly documented ("simple majority") | The largest holder is president. On a tie, the incumbent keeps it. |
| Offices when a monopoly is lost | Unknown | The offices stay. Their count still drives price and rent, as in S1's tables, where offices always imply a monopoly. |
| Even building, office purchase price, mortgages | Board / deed rules, not the unit | Not enforced. Pay with paper money as printed on the board. |
| Bull / Bear cards, Stock Exchange square | Card texts unknown | No special keys. The cards' effects are entered with the normal operations. |
| Original sounds, power-on or self-test screen | Unknown | Synthesised beeps (optional). The test mode lights every segment. |
| Greek company names / currency | Unknown | Numbers 01–22. Names can be set in Settings. Amounts are plain numbers. |

## 5. Research limits

This build environment could reach web *search* but not the rule-book PDFs themselves (spelregels.eu, spiele4us.de, BoardGameGeek images and hasbro.com were blocked by the network policy). The best next step for full authenticity is **photos of the unit (front and keypad) and of the Greek rule-book pages that describe the buttons**. Every unverified choice above is isolated in `src/keymap.ts`, `src/engine/keypad.ts` or one function in `src/engine/game.ts`, so it can be corrected without touching the rest.
