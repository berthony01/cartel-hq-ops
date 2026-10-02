# Audit report: canonical PCART Deploy & Contract (read-only)

HEAD: `08101e87` "Fixed PCART Safe card display" (follows `26911727`, the earlier UI fix). Production only has this code if it has been published since then. That was not checked, because publishing is out of scope.

## A. Every address shown in the Treasury cards (Severity: High, a confusing display, not a data problem)
| Shown as | What it is |
|---|---|
| Signer setup card: 3 addresses | Saved signers 1–3 (match the live DB) |
| Safe card: "Owners" (3) | The same 3 saved signers |
| Safe card: "Predicted Safe address" `0xe0d0…ad03` | The future Safe contract address. It is not a wallet or an owner |
| Safe card: "Connected: 0x…" | Whichever browser wallet is connected. Only shown after you press Connect |
| Technical details (collapsed): Factory, Singleton, Fallback handler | Fixed, official Safe system contracts |
| "Transaction: 0x…" | Only shown after a send attempt (none so far) |

No fourth owner is added anywhere. The setup data uses exactly the 3 saved signers with an approval threshold of 2. The connected wallet is only checked against those 3 and is never added. Most likely cause of the complaint: "Predicted Safe address" and "Connected:" both look like wallet addresses and sit right under "Owners", with nothing explaining what they are.

## B. Where the predicted address comes from
`treasury-safe-create.ts`: the address is calculated with the standard formula Safe uses for new Safes (CREATE2). The inputs are the factory, a hash of the setup data (3 owners, threshold 2) and a fixed nonce derived from the launch ID and the signers. It is a calculation only: the address of a contract that does not exist yet. It never signs anything and no one owns it as a wallet.

## C. What the page shows, in order (`launch-control.tsx` 2811–3110)
1. Guidance header (headline / Why / What happens next)
2. "Deployment path" list. **Out of date:** it still says "Now: save signers" and "Later: create Safe", even though signers are saved
3. Treasury signer setup card
4. Treasury Safe creation card (shows only when saved signers exist)
5. Protected PCART checkpoint ("BLOCKED")
6. Three boxes: Registration, Deployment records (shows "5"), Registered at
7. Official contract registration card
8. Notify watchers card
9. Group broadcast card
10. Contract correction card
11. "Technical deployment evidence" (collapsed), containing the old generic deployment history

## D. Generic or non-PCART sections in the PCART flow
| Section | Matters now? |
|---|---|
| Deployment path list (wrong stage) | Not now: misleading |
| Protected checkpoint | Later: after the Safe exists |
| Registration/Records/Registered boxes | Not now: "5 records" points to the old test runs |
| Official contract registration | Later |
| Notify watchers / Group broadcast | Later, after registration |
| Contract correction | Later, after registration |
| Technical deployment evidence (5 Sep-4 test rows) | Not relevant to PCART. Keep for audit only |
| Generic deployment request card | Already hidden for PCART |

## E. Why the clutter is still there (Severity: High)
The last fix only reordered the Safe card and put the evidence behind a collapsed section with a note. It did not hide any of items 6–10, and those always show. The old evidence history **is still on the page for PCART**, inside the collapsed "Technical deployment evidence" section (line 3099). The "Deployment records: 5" box also points at those old rows even while the section is closed.

## F. Protected checkpoint (Severity: Medium)
It repeats what the token-deployment locks already enforce. Showing "BLOCKED" right after the Safe card makes the Safe step look blocked too. It would make more sense after the Safe is verified, framed as "next phase, locked".

## G. Signer setup card wording (Severity: Medium)
The card says "three keys to one treasury" and "2-of-3". It never says that creating the Safe produces **one new contract address**, and that this address is not a fourth signer. The Safe card does not say it either.

## H. Proposed smallest redesign (UI only, canonical PCART only)
What you would see:
1. A short step list that reflects where you actually are: Signers saved, then Create Safe, then (locked) Deployment.
2. Signer card, shrunk to a summary once signers are saved ("3 signers saved, 2 of 3 required" plus an Edit link).
3. Safe card, with labels added:
   - "Owners (your 3 signer wallets)"
   - "Safe address (new contract — not a wallet, not a 4th signer)"
   - "Connected wallet (used only to approve; must be one of the 3)"
4. Nothing after that until the Safe is verified. After that: the protected checkpoint.

Hidden for PCART until the Safe is verified (and later, until a contract is registered): the three summary boxes, registration, notify, broadcast and correction cards.

Moved into a single collapsed "Advanced / Audit" section at the very bottom: the technical evidence and the "5 records" count. No data is deleted. Other launches stay exactly as they are.

Proposed files to change: `launch-control.tsx`, `TreasurySafeCreatePanel.tsx` (labels only), `TreasurySignerSetupPanel.tsx` (wording plus summary view), and the simplification regression script. No changes to chain logic, the database, wallet sending or deployment controls.

## I. Data safety (confirmed)
- Live DB: signer_1 `0xc23b…9245`, signer_2 `0xa068…3f67`, signer_3 `0xe5b2…d617`, threshold 2, safe_address NULL. These match the authoritative values.
- None of the recent UI commits write signer data. No Safe has been created or saved.
- No transaction was sent and nothing was edited during this audit.

## Severity summary
- Critical: none. There is no fourth owner, and no data was changed.
- High: addresses with no labels (A); clutter still showing (E).
- Medium: step list out of date (C2); checkpoint in the wrong place (F); missing explanation (G).
- Low: "Deployment records: 5" box (D).

Stop point: this is the audit only. Approving it does not authorise building the redesign; that needs a separate go-ahead.
