# Guide for coding agents

Read this before changing the code. It explains what the app is, how it is put together, the rules every change
must keep, and how to check your work. `DESIGN.md` has the full data model and the reasoning behind it.

## What this is

**Josh Billing App**: an offline desktop app for Indian small businesses: GST invoices, purchases, stock, payments,
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
- **Images** (logo, signature, item photo) are data URLs stored in the database, so backups carry them.
- **Printing:** the same HTML from `src/shared/invoiceHtml.ts` is used for the preview, printing and PDF. The data
  comes from `printData()` in `src/main/ipc.ts`; add new print inputs there.
- **Imports are two-step:** `previewImport` checks every row and saves nothing; `commitImport` saves the good rows in
  one transaction. On an update, a blank cell keeps the saved value.
- Write user-facing text in plain English for a shop owner. Use Indian formats (₹1,23,456.78, DD-MM-YYYY on prints).

## Testing

- Unit tests sit next to the code (`*.test.ts`) and use an in-memory database: `openDatabase(':memory:')`, then
  `setupBusiness(...)` with `EMPTY_TEST_PROFILE` from `src/shared/testFixtures.ts`. Test GSTINs must have a valid
  check digit (use `gstinCheckChar`).
- 247 tests at the time of writing. Add tests for every rule you add, including the refusals.
- End-to-end: `scripts/e2e/README.md`. Use a separate `--user-data-dir` so real data is never touched.
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

## Not built yet

Users and roles (passcode), sync between devices, import from Tally, reverse charge, composition scheme, TCS/TDS,
free quantity, stock per batch, multi-currency, WhatsApp/SMS sending, e-invoice (IRN). Ask the owner before
starting any of these; sync in particular needs decisions first.

## Git

- Branch `main`, remote `prasannab4362/Josh_billing_app` (public). Commits are authored as `prasannab4362`
  (repo-local git config).
- **Do not add `Co-Authored-By` or any AI attribution to commits or PRs** in this repo; the owner asked for that.
- Never commit business data: `*.db`, backups, `out/`, `node_modules/` are ignored. Use made-up names, phone
  numbers and GSTINs in tests (the repo is public).
