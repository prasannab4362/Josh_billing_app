# Guide for coding agents

Read this before changing the code. It explains what the app is, how it is put together, the rules every change
must keep, and how to check your work. `DESIGN.md` has the full data model and the reasoning behind it.

## What this is

**Josh Books**: an offline desktop app for Indian small businesses: GST invoices, purchases, stock, payments,
cash and bank, expenses, reports and GST returns. It is our own design. It was inspired by how apps like Vyapar
work, but **no code, screens, names or artwork are copied**. Keep it that way: build features from how they should
work, in this app's own look.

Stack: Electron 33 + electron-vite, React 18 + TypeScript, better-sqlite3, vitest. No UI library; plain CSS in
`src/renderer/src/styles.css`. Very few dependencies by choice: barcodes, QR codes and Excel files are handled by
our own small modules.

## Commands

```bash
npm install          # postinstall rebuilds better-sqlite3 for Electron
npm run dev          # app with live reload
npm test             # vitest, run inside Electron's Node (ELECTRON_RUN_AS_NODE) so better-sqlite3 loads
npm run typecheck    # both tsconfigs (node + web)
npm run build        # out/
```

Before you say a change is done, run `npm test`, `npm run typecheck` and `npm run build`. For screen changes,
also check in the real app (`scripts/e2e/`).

## Layout

```
src/main/            Electron main process (Node)
  index.ts           window, startup, daily auto-backup
  ipc.ts             one handler per API method; print data assembly; file dialogs
  session.ts         open/close/switch business, backup, restore, import a backup
  registry.ts        list of businesses on this computer (each is its own .db file)
  db/                connection (pragmas) and migrations (PRAGMA user_version, now v8)
  services/          all business rules; one file per area (invoices, payments, items, parties, stock,
                     ledger, reports, gstReturns, imports, labels, printDesign, recycleBin, auditLog, ...)
  print.ts           print / PDF through hidden BrowserWindows
  xlsx.ts            own .xlsx (ZIP + XML) reader/writer and CSV reader
src/preload/         exposes window.api (only the methods listed in API_METHODS)
src/shared/          used by main and renderer: models, ipc contract, GST maths (tax.ts), money/qty,
                     billTypes, invoiceHtml (the printed invoice), labels, barcode, qr, reportDoc,
                     printSettings, itemFields, features, imports, validation, states, gstin
src/renderer/src/    React: App/Shell, screens/<area>/..., components/, api.ts, styles.css
scripts/e2e/         drive the running app over CDP (see its README)
docs/business-guides/ one guide per trade (wholesale, retail, grocery, fish market, services, medical,
                     electrical, stationery, jewellery, gold covering), checked by scripts/e2e/business-check.mjs
docs/setup-guide/     customer setup guide with screenshots: barcodes, QR, labels, scan billing, bill vs invoice
                     (screenshots and checks come from scripts/e2e/shop-tour.mjs)
```

## Rules every change must keep

- **Money is integer paise**, quantities are integer **milli-units** (1 pc = 1000), rates are **basis points**
  (18% = 1800). Parse with `toPaise`, `toMilli`, `percentToBp`; format with `formatINR`, `formatQty`. Never store
  or add floats.
- **The UI never touches the database.** Screens call `window.api.*` (typed in `src/shared/ipc.ts`).
  To add a call: add it to `BillingApi` and to `API_METHODS` in `src/shared/ipc.ts`, and add a handler in
  `src/main/ipc.ts`. The preload picks it up from `API_METHODS`.
- **Every save is one transaction** (`db.transaction(...)`), so stock, ledger, numbering and links stay consistent.
  A failed check throws `UserError` with a message a shop owner understands; nothing is half saved.
- **Balances come from the double-entry `ledger_entry` table** (positive = debit), **stock from `stock_movement`**.
  Cached values (item_stock, document paid/balance) are rebuilt from those; never edit a cache by hand.
- **Soft delete** (`deleted_at`) plus `audit_log`; deleted bills go to the recycle bin and can be restored.
  `billInput()` in `services/recycleBin.ts` must copy every field of a bill, so add new bill fields there too.
- **Bill types** come from `BILL_INFO` in `src/shared/billTypes.ts` (sale invoice, estimate, sale order, delivery
  challan, credit note, purchase bill, purchase order, debit note): side, sign, whether it posts, numbering,
  conversions, returns. Quotes/orders/challans do not post. Returns are set off through `document_link`.
- **Schema changes are new migrations** at the end of `src/main/db/migrations.ts` (next is version 9). Never edit an
  old migration; business files already on users' computers depend on them.
- **better-sqlite3 parameters:** use `?` or named `@name` with an object. Numbered `?1` fails here.
- **Business settings** that are not columns live in the `setting` table as JSON. Each has a `complete...()` function
  that fills missing parts from defaults, so older files keep working: print design (`print.design`), line details
  (`item.fields`), features and own fields (`features`), label sizes and design (`labels.sizes`, `labels.design`).
- **Images** (logo, signature, item photo) are data URLs stored in the database, so backups carry them. Pictures are
  read with FileReader (`renderer/src/images.ts`): the page's security policy blocks `blob:` images. A signature photo
  has its paper made transparent on upload (`shared/inkOnly.ts`), so it prints cleanly. The logo prints on every paper;
  the signature on A4/A5, and on thermal bills only with `show.signatureOnBill`.
- **Printing:** the same HTML from `src/shared/invoiceHtml.ts` is used for the preview, printing and PDF. The data
  comes from `printData()` in `src/main/ipc.ts`; add new print inputs there. Any bill can be printed on another paper
  than the business default (the `paper` argument of `getBillPrint` / `printBill` / `exportBillPdf`, shown as the
  "Print as" switch: bill 80/58 mm or invoice A4/A5).
- **Data must never die.** Every business file is opened with `synchronous = FULL` (WAL) and checked for damage on
  open (`databaseProblems` in `db/connection.ts`): a damaged file is refused with a message naming the newest
  backup, never opened and written to. Backups are written beside their target as `.partial`, checked
  (`quick_check`, bill count) and only then moved into place; a damaged backup is never restored. Backups are
  refreshed every 30 minutes and on closing, and copied to the owner's second place (`Session.mirrorDir`, stored in
  `app-settings.json`; a pen drive or a OneDrive/Google Drive folder). New code that opens a database must close it
  on every error path.
- **Pictures in HTML:** any logo, signature or photo put into a printed page goes through `safeImage()`
  (`shared/safeHtml.ts`): only base64 PNG, JPEG and WebP data URLs pass. Text goes through the page's `esc()`.
- **Wholesale:** `isWholesale`/`linePrice` in `shared/pos.ts` are the one rule for the counter AND the invoice
  editor: the item's wholesale price applies from its minimum quantity (counted in main units, so 2 dozen = 24 pcs),
  or on every item that has one when the bill is a "wholesale bill". `bulkHint` suggests that switch when a bill is
  bulk-sized only across items (textile sizes are separate items). A price typed on a line is never replaced.
  `services/textile.test.ts` checks counter and saved invoice agree to the paisa over 150 random bills.
- **CSS class names are shared across screens:** before adding a generic class (`link`, `card`, `tab`…) grep
  `styles.css`; a clash once wiped the dashboard cards' padding. `scripts/e2e/ui-check.mjs` finds such damage.
- **Nothing is sent from the app.** WhatsApp opens through `https://wa.me/` links with the text filled in; the user
  presses Send. `openSafe` in `src/main/share.ts` only opens wa.me, Gmail's compose page, `mailto:` (address, subject, body only),
  `sms:` (an Indian mobile and body only), Google Business and Google review links (`isSafeExternalUrl` in
  `shared/share.ts`); keep that list short. Sending automatically through a linked WhatsApp is not done: WhatsApp's
  terms forbid automating it and it can get the number banned. Posters and catalogues are made on the computer; nothing is uploaded.
- **Imports are two-step:** `previewImport` checks every row and saves nothing; `commitImport` saves the good rows in
  one transaction. On an update, a blank cell keeps the saved value.
- **Look and feel:** colours come from the CSS variables at the top of `styles.css`, which have a light and a dark
  set (`data-theme` on `<html>`, see `renderer/src/theme.ts`). Use the variables, never fixed colours, or dark mode
  breaks. Icons come from `components/Icon.tsx` (our own line drawings; add new ones there, no icon library);
  `PageTitle`, `IconTile` and `EmptyState` give pages their header, tinted icons and empty states.
- Write user-facing text in plain English for a shop owner. Use Indian formats (₹1,23,456.78, DD-MM-YYYY on prints).

## Testing

- Unit tests sit next to the code (`*.test.ts`) and use an in-memory database: `openDatabase(':memory:')`, then
  `setupBusiness(...)` with `EMPTY_TEST_PROFILE` from `src/shared/testFixtures.ts`. Test GSTINs must have a valid
  check digit (use `gstinCheckChar`).
- 296 tests at the time of writing. Add tests for every rule you add, including the refusals.
- End-to-end: `scripts/e2e/README.md`. Use a separate `--user-data-dir` so real data is never touched.
- `scripts/e2e/business-check.mjs` sets up one test business per trade and checks its everyday bills (totals, GST
  split, stock, payments, PDF). Run it after changes to billing, tax, units, stock or printing, and update the
  matching guide in `docs/business-guides/` when a trade's workflow changes.
- `scripts/e2e/shop-tour.mjs` checks barcodes, QR codes and labels for six shops (reads every printed code back with
  OpenCV via `scripts/e2e/read-codes.py`), bills by scanning, and prints each bill as a receipt and as an A4 invoice.
  Run it after changes to labels, barcodes, scanning or printing, and refresh `docs/setup-guide/images` from its output.
- `scripts/e2e/label-designs.mjs` prints all 8 label designs (`LABEL_STYLES` in `shared/labels.ts`) with a barcode and a
  QR code for items numbered with an own pattern (472-00001~1, `CodeFormat` in `shared/barcode.ts`), reads every printed
  code back (Code 128 with the bar reader in `read-codes.py`), and bills by scanning. Run it after label changes.
- `scripts/e2e/year-codes.mjs` checks year-letter numbering with sizes (`EE-00001~1`, `~2`…; `CodeFormat` kind `yearly`):
  sets it in the labels window, uses **Add sizes** (`addItemSizes` in `services/items.ts`), prints and reads back the tags,
  and bills by scanning. Year letters move with the accounting year (`currentFy` in `services/labels.ts`).
- `scripts/e2e/pos-share.mjs` checks the POS (scan, wholesale from the minimum quantity, F-keys, discount, charge,
  change, walk-in must pay in full, credit to a customer, Ctrl+P print, bill tabs) and the share panel (24 checks).
- `scripts/e2e/ui-check.mjs` visits every page and settings menu entry at 960×600, 1280×800 and 1600×900 and fails on
  anything cut off or scrolling sideways (66 checks). Run it after any CSS or layout change.
- `scripts/e2e/textile-wholesale.mjs` (18 checks): bulk order over sizes, exact switch at the minimum, `+`/`−`/typed
  quantities, tax-inclusive saree, and the same bill made in the counter and in the invoice editor.
- `scripts/e2e/backup-safety.mjs` (7 checks): second backup place, damage check.
- `scripts/e2e/logo-signature.mjs` uploads a logo and a signature photo through the real Settings › Business boxes and
  checks both print on A4, A5, 80 mm and 58 mm (run shop-tour.mjs first; it uses that clothing shop).
- Barcodes/QR were verified by reading rendered labels with OpenCV; the QR encoder was checked for all 40 versions
  × 4 levels. If you change `barcode.ts`, `qr.ts` or `labels.ts`, check again the same way.

## Features, and where they live

| Area | Main files |
|---|---|
| Onboarding, businesses, switcher | `screens/Onboarding.tsx`, `Welcome.tsx`, `main/session.ts`, `main/registry.ts` |
| Parties, items, units, tax rates | `services/parties.ts`, `items.ts`, `units.ts`, `taxRates.ts`; `screens/parties`, `screens/items` |
| Bills (all 8 types), conversions, returns | `services/invoices.ts`, `shared/billTypes.ts`, `screens/sales/InvoiceEditor.tsx`, `SalesPage.tsx` |
| GST maths | `shared/tax.ts` (line tax, inclusive prices, round off), `shared/gstin.ts`, `shared/states.ts` |
| Payments, cash & bank, expenses | `services/payments.ts`, `accounts.ts`, `expenses.ts`, `ledger.ts` |
| Stock | `services/stock.ts`, `inventory.ts` |
| Reports, GSTR-1/3B | `services/reports.ts`, `gstReturns.ts`, `shared/reportDoc.ts`, `shared/gstr1Json.ts`, `screens/reports` |
| Backup, recycle bin, history | `main/session.ts`, `services/recycleBin.ts`, `auditLog.ts`, `screens/settings/DataTabs.tsx` |
| Barcodes, QR, labels, scanning | `shared/barcode.ts`, `shared/qr.ts`, `shared/labels.ts`, `services/labels.ts`, `screens/items/LabelsModal.tsx`, `CustomSizeModal.tsx`; scan box in `InvoiceEditor.tsx` |
| Excel import/export, bulk update | `main/xlsx.ts`, `services/imports.ts`, `shared/imports.ts`, `components/ImportModal.tsx`, `screens/items/BulkUpdateModal.tsx` |
| Print designs, UPI QR | `shared/printSettings.ts`, `shared/invoiceHtml.ts`, `services/printDesign.ts`, `screens/settings/PrintTab.tsx` |
| Batch / dates / model / size / serial on lines | `shared/itemFields.ts`, `document_line.details`, `screens/settings/ItemFieldsTab.tsx` |
| Transport, PO, time, profit, own fields | `shared/features.ts`, `document.extra`, `party.extra`, `item.extra`, `screens/settings/FeaturesTab.tsx`, `components/OwnFields.tsx` |
| Grow: posters, catalogue, Google profile | `shared/posters.ts` (templates, own CSS art, en/hi/ta text), `shared/share.ts` (catalogue HTML, WhatsApp texts and wa.me links), `main/share.ts` (PNG via offscreen window, clipboard, PDF, safe link opening), `screens/grow/GrowPage.tsx` |
| Counter billing (POS) | `shared/pos.ts` (prices incl. wholesale, totals, change, the sale it saves as; tested in `services/pos.test.ts`), `screens/pos/PosPage.tsx` (bill tabs, scan/search, F2–F12 keys, Ctrl+P/S/T/W/B). Saves an ordinary sale invoice, so stock, ledger and GST work as for any bill |
| Sharing a bill | share panel in `screens/sales/SalesPage.tsx` (WhatsApp, Gmail, mail app, text message, PDF, thermal and sheet print), `components/ShareModal.tsx`, `shareBill` in `main/ipc.ts`; links from `shared/share.ts` |
| WhatsApp from bills and parties | `components/WhatsAppModal.tsx`, `shareBillOnWhatsApp` in `main/ipc.ts` (PDF to Documents\Billing App\Shared, then wa.me) |

## Not built yet

Online store, ads and Google sign-in (need servers), a website version and live sync between devices (needs a hosted
server and the owner's decisions: see DESIGN.md §9), WhatsApp linked-device sending, import from Tally, reverse charge, composition scheme, TCS/TDS,
free quantity, stock per batch, multi-currency, WhatsApp/SMS sending, e-invoice (IRN). Ask the owner before
starting any of these; sync in particular needs decisions first.

## Git

- Branch `main`, the remote is the project's GitHub repository (public). Commits are authored as `Josh Billing`
  (repo-local git config).
- **Do not add `Co-Authored-By` or any AI attribution to commits or PRs** in this repo; the owner asked for that.
- Never commit business data: `*.db`, backups, `out/`, `node_modules/` are ignored. Use made-up names, phone
  numbers and GSTINs in tests (the repo is public).
