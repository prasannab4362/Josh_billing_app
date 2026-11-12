# Billing App — Design (v0.1)

An offline-first GST billing, inventory and accounts app for small Indian businesses.
Own design: the ideas are common to all billing software; the structure below is ours.

---

## 1. Goals and scope

**MVP must do:** business setup, parties, items, sale invoice with GST, PDF print/share,
payments in/out, purchase bills, stock, party balances, basic reports, local backup.

**Later:** estimates/orders/challans, returns, expenses, GSTR-1/3B export, multiple firms,
users and roles, cloud sync, mobile app, e-invoice/e-way bill.

**Non-goals for now:** payroll, full manufacturing, POS hardware.

---

## 2. Architecture

```
┌────────────────────────────────────────────┐
│  UI (React + TypeScript)                   │  screens, forms, tables
├────────────────────────────────────────────┤
│  App services (TypeScript)                 │  all business rules live here
│   - DocumentService  - PaymentService      │  (UI never writes to the DB)
│   - StockService     - TaxEngine           │
│   - NumberingService - ReportService       │
├────────────────────────────────────────────┤
│  Repository layer (SQL queries)            │
├────────────────────────────────────────────┤
│  SQLite file per business  (better-sqlite3)│
└────────────────────────────────────────────┘
Shell: Electron (or Tauri for a smaller install)
PDF: HTML template -> print-to-PDF
```

Key decisions:

| Decision | Choice | Why |
|---|---|---|
| Storage | One SQLite file per business | Offline, easy backup = copy file |
| Money | Integer **paise** (₹1 = 100) | No floating-point rounding bugs |
| Quantities | Integer in **milli-units** (1 pc = 1000) | Allows 0.5 kg etc. without floats |
| IDs | UUID text | Safe for future multi-device sync |
| Balances & stock | **Derived from entries**, cached | Never drift; cache is rebuildable |
| Edits | Soft delete + audit log | Recoverable, accountable |
| Every save | One DB transaction | Stock, balance, numbering stay consistent |

---

## 3. Data model

### 3.1 Business setup

**business** (one row per file)
- id, name, legal_name, gstin, pan, state_code, address, city, pincode
- phone, email, logo_path, signature_path, business_type, category
- fy_start_month (default 4 = April), currency (INR), created_at

**bank_account**
- id, name, bank_name, account_no, ifsc, upi_id, opening_balance, opening_date
- kind: `cash` | `bank` | `upi_wallet`, is_default_for_print

**setting** — key / value (JSON) for toggles: tax inclusive default, print layout, round-off rule, etc.

**number_series**
- id, doc_type, prefix (e.g. `INV/25-26/`), next_number, padding, fy, is_default

**tax_rate**
- id, name (`GST 18%`), rate_bp (basis points: 1800), cess_bp, kind: `gst` | `exempt` | `nil` | `non_gst`

### 3.2 Masters

**party**
- id, name, display_name, kind: `customer` | `supplier` | `both`
- phone, email, gstin, state_code, billing_address, shipping_address
- opening_balance (+ receivable / − payable), opening_date
- credit_limit, payment_term_days, group_id, is_active

**party_group** — id, name

**unit** — id, name, short (`pcs`, `kg`, `box`)

**item**
- id, name, code/sku, kind: `goods` | `service`, category_id
- hsn_sac, tax_rate_id, price_includes_tax (bool)
- sale_price, purchase_price, mrp, wholesale_price, wholesale_min_qty
- base_unit_id, alt_unit_id, alt_conversion (e.g. 1 box = 12 pcs)
- track_stock (bool), opening_qty, opening_rate, low_stock_qty
- track_batch, track_serial (later), is_active

**item_category** — id, name

**party_price** (optional) — party_id, item_id, sale_price, purchase_price

### 3.3 Documents (one structure for all)

**document** — header for every bill-like thing
- id, doc_type (see table), number, series_id, date, due_date
- party_id, party_snapshot (JSON: name, gstin, address at time of billing)
- place_of_supply (state_code), supply_type: `intra` | `inter`
- prices_include_tax
- subtotal, discount_total, taxable_total, cgst, sgst, igst, cess
- charges_total, round_off, grand_total
- paid_amount, balance_due, status
- notes, terms, source_doc_id (converted from), created_by, created_at, updated_at, deleted_at

**doc_type values**

| Code | Name | Stock | Party balance | Numbered |
|---|---|---|---|---|
| `SALE_INVOICE` | Sale Invoice | − out | + receivable | yes |
| `SALE_RETURN` | Credit Note | + in | − receivable | yes |
| `ESTIMATE` | Estimate/Quotation | none | none | yes |
| `SALE_ORDER` | Sale Order | none | none | yes |
| `DELIVERY_CHALLAN` | Challan | − out* | none | yes |
| `PURCHASE_BILL` | Purchase Bill | + in | + payable | supplier's no. |
| `PURCHASE_RETURN` | Debit Note | − out | − payable | yes |
| `PURCHASE_ORDER` | Purchase Order | none | none | yes |
| `EXPENSE` | Expense | none | optional | no |

\* configurable.

**document_line**
- id, document_id, line_no, item_id, description
- qty, unit_id, unit_factor, rate, discount_pct, discount_amount
- taxable_amount, tax_rate_id, tax_rate_bp, cgst, sgst, igst, cess, line_total
- hsn_sac (snapshot), batch_no (later)

**document_charge** — document_id, name (Shipping/Packing), amount, tax_rate_id, tax_amount

**document_link** — from_doc_id, to_doc_id, kind: `converted` | `returned_against`

### 3.4 Money

**payment**
- id, direction: `in` | `out`, number, date, party_id, amount
- account_id (cash/bank), mode: `cash` | `upi` | `bank` | `cheque` | `card`
- reference (UTR / cheque no), notes, deleted_at

**payment_allocation** — payment_id, document_id, amount
(one payment can settle many invoices; unallocated part = advance)

**cheque** (later) — payment_id, cheque_no, cheque_date, status: `open` | `deposited` | `bounced`

**account_transfer** — from_account_id, to_account_id, amount, date (cash↔bank, bank↔bank)

### 3.5 Ledger (source of truth for balances)

**ledger_entry** — written by services, never by UI
- id, date, source_type (`document` | `payment` | `opening` | `transfer` | `adjustment`), source_id
- account: `party:<id>` | `bank:<id>` | `sales` | `purchase` | `gst_out` | `gst_in` | `expense:<cat>`
- debit, credit

Party balance = Σ(debit − credit) for `party:<id>`.
Cash/bank balance = same for `bank:<id>`. P&L and balance sheet come from the same table.

### 3.6 Stock

**stock_movement** — id, date, item_id, qty_change (+/−, base units), rate, source_type, source_id, location_id (later)

Current stock = Σ qty_change (opening stock is itself a movement with source_type `opening`). Cached in **item_stock** (item_id, qty, value at weighted-average cost), rebuildable.

**stock_adjustment** — id, date, item_id, qty_change, reason (damage, count correction)

### 3.7 System

**audit_log** — id, at, user_id, entity, entity_id, action (`create` | `update` | `delete`), before_json, after_json
**user** (later) — id, name, phone, role, pin_hash, is_active
**schema_version** — version number for migrations

---

## 4. Core rules

### 4.1 GST calculation (TaxEngine)

```
supply_type = (place_of_supply == business.state_code) ? intra : inter

per line:
  gross     = qty × rate
  discount  = gross × discount_pct  (or fixed amount)
  if prices_include_tax:
      taxable = (gross − discount) / (1 + rate_bp/10000)
  else:
      taxable = gross − discount
  tax       = taxable × rate_bp / 10000
  intra -> cgst = tax/2, sgst = tax/2
  inter -> igst = tax
  cess      = taxable × cess_bp / 10000

document:
  totals = Σ lines + Σ charges (charges taxed at their own rate)
  round_off = round(total to nearest ₹1) − total   (setting)
  grand_total = total + round_off
```
Rounding: compute each line in paise with half-up rounding; sum the rounded values.
Unregistered customer (no GSTIN) → B2C; with GSTIN → B2B (matters for GSTR-1).

### 4.2 Saving a document (DocumentService.save) — one DB transaction

1. Validate (party, at least one line, dates, credit limit warning).
2. Run TaxEngine → totals.
3. If new and numbered: take `next_number` from series, increment.
4. Write document + lines + charges.
5. Delete previous ledger/stock rows for this document (on edit), then write new:
   - **Sale invoice:** Dr party, Cr sales, Cr gst_out; stock −qty per goods line.
   - **Purchase bill:** Dr purchase, Dr gst_in, Cr party; stock +qty.
   - Returns: the reverse.
6. If "received now" > 0: create a payment + allocation to this document.
7. Recompute `paid_amount`, `balance_due`, `status`; refresh caches.
8. Write audit_log.

Any failure → rollback; nothing half-saved.

### 4.3 Payments

- Payment In: Dr bank/cash, Cr party.
- Auto-allocate to oldest unpaid invoices (user can change).
- Invoice status: `unpaid` → `partial` → `paid`; `overdue` if past due_date with balance.

### 4.4 Conversion

Estimate → Sale Order → Challan → Invoice: copy lines into a new draft, set `source_doc_id`,
add `document_link`; source marked `converted` (locked from editing by default).

### 4.5 Delete / cancel

- Soft delete (`deleted_at`) and remove its ledger + stock rows; keep in a Recycle Bin view; restore re-posts.
- Numbers are never reused (gaps are allowed and visible).

### 4.6 Financial year

Number series reset per FY (`INV/25-26/0001`). Reports filter by FY by default.

---

## 5. Screens

### 5.1 First run / onboarding
1. **Welcome** → Create business / Restore from backup.
2. **Business details** — name, phone, GSTIN (optional; fetch state from first 2 digits), state, address.
3. **Preferences** — GST registered? prices include tax? invoice prefix, print size (A4 / thermal 3").
4. **Bank/UPI** (optional) — shown on invoice with UPI QR.
5. → Dashboard. Defaults (units, GST rates, cash account, series) seeded automatically.

### 5.2 Main layout
```
┌──────────┬───────────────────────────────────────────┐
│ Sidebar  │ Top bar: business switcher, search, + New │
│ Dashboard├───────────────────────────────────────────┤
│ Parties  │                                           │
│ Items    │              content                      │
│ Sale     │                                           │
│ Purchase │                                           │
│ Cash&Bank│                                           │
│ Expenses │                                           │
│ Reports  │                                           │
│ Settings │                                           │
└──────────┴───────────────────────────────────────────┘
```
Keyboard: `Alt+S` new sale, `Alt+P` new purchase, `Alt+I` payment in, `Ctrl+F` search.

### 5.3 Screen list

| Screen | Contents |
|---|---|
| **Dashboard** | Today's sales, receivable, payable, cash+bank balance, low stock, overdue invoices, 30-day sales chart |
| **Parties** | List (name, phone, balance colour-coded) + detail pane: info, statement of all docs/payments, buttons: New invoice, Receive payment, Send reminder |
| **Party form** | Name, phone, GSTIN, state, addresses, opening balance, credit limit, terms |
| **Items** | List (name, stock, sale price, value) + detail: stock movements, price history |
| **Item form** | Name, code, HSN, tax, prices, units, opening stock, low-stock alert |
| **Sale list** | Filter by date/status/party; columns: date, no., party, total, balance, status |
| **Invoice editor** | Party picker (create inline), date, due date, POS; line grid (item, qty, unit, rate, disc, tax, amount); charges; totals panel; "Received" amount + account; Save / Save & Print / Save & Share |
| **Invoice view** | Rendered invoice, Print, PDF, WhatsApp, Receive payment, Convert, Return, Edit, Delete |
| **Purchase list / bill editor** | Same pattern, supplier side |
| **Payment In/Out** | Party, amount, account, mode, reference; allocation table of open invoices |
| **Cash & Bank** | Accounts with balances; transactions per account; transfers |
| **Expenses** | Category, amount, account, optional GST |
| **Reports** | See §6 |
| **Settings** | Business, invoice numbering, print templates, tax rates, units, backup, users (later) |

### 5.4 Invoice print template
Header (logo, business, GSTIN, address) · "TAX INVOICE" · invoice no/date/due/POS ·
Bill to / Ship to · line table (S.No, item, HSN, qty, rate, disc, taxable, GST %, amount) ·
tax summary by rate (CGST/SGST or IGST) · totals, amount in words · bank + UPI QR ·
terms · signature.

---

## 6. Reports (all derived from documents, payments, ledger, stock)

| Report | Source |
|---|---|
| Sale / Purchase register | document by type and date |
| Day book | all documents + payments for a day |
| Party statement | ledger_entry for `party:<id>` with running balance |
| Receivables / Payables ageing | unpaid documents bucketed 0–30/31–60/61–90/90+ |
| Cash & bank book | ledger_entry for `bank:<id>` |
| Stock summary | item_stock; value at purchase rate |
| Low stock | item_stock < low_stock_qty |
| Item-wise sales & profit | lines × (sale rate − avg purchase cost) |
| Profit & Loss | ledger: sales − purchases ± stock change − expenses |
| GST summary | tax per rate, in vs out |
| GSTR-1 (later) | B2B / B2CL / B2CS / CDNR / HSN sections, JSON + Excel export |
| GSTR-3B (later) | outward tax, ITC, net payable |

All reports: date-range filter, print, Excel/PDF export.

---

## 7. Backup and data safety

- Auto backup on close to `Documents/BillingBackups/<business>/<date>.db` (keep last 30).
- Manual backup / restore from Settings.
- Schema migrations run on open with a backup taken first.
- Later: encrypted cloud backup, then sync (UUIDs + `updated_at` + change log).

---

## 8. Build phases

| Phase | Deliverable |
|---|---|
| **0** | Project skeleton: Electron + React + SQLite, migrations, money/qty helpers, tests |
| **1** | Onboarding, business settings, number series, tax rates, units |
| **2** | Parties and items (CRUD, opening balances, opening stock) |
| **3** | TaxEngine + sale invoice editor + save posting + invoice PDF |
| **4** | Payments in/out with allocation; party statement; cash & bank |
| **5** | Purchase bills, stock movements, stock summary, low stock |
| **6** | Dashboard + core reports (registers, day book, ageing, P&L, GST summary, item-wise profit, stock); print, PDF and CSV export — done |
| **7** | Estimates, orders, challans, conversion; returns (credit/debit notes set off against the bill); expenses (paid from cash/bank, GST credit, in P&L) — done |
| **8** | Backup/restore (manual, daily automatic ×7, safety copy before restore, open backup as new business), recycle bin with restore, change history viewer — done |
| **9** | GSTR-1 (all tables + portal JSON) and GSTR-3B (with ITC set-off) — done; multi-firm — done (one file per business, switcher, since Phase 1); users & roles, sync — not started |
| **10** | Barcodes, QR codes and labels; Excel import/export and bulk update; print designs with UPI QR; line details (batch, dates, model, size, serial); transport/PO details, time on prints, profit while billing, own fields for parties and items — done (see "Added after phase 9") |

Phases 0–4 = a usable billing app.

---

## 9. Open decisions

Settled:

1. **Shell:** Electron.
2. **Firms:** one business per database file, several per computer, with a switcher.
3. **Thermal printers:** 58 and 80 mm receipt layouts printed through the system printer; no direct ESC/POS.
4. **Importing existing data:** items and parties from Excel/CSV, with matching headings recognised.

Still open (need the owner's decision before building):

5. **Users and roles:** passcode only, or named users with permissions?
6. **Sync between devices:** none, a shared folder, or a server? Affects IDs (already UUIDs) and conflict rules.
7. **Stock per batch:** keep batch as a printed detail (today) or track stock and expiry per batch?

## Added after phase 9

- **Barcodes and labels:** EAN-13 / Code 128 and QR codes (own encoders, `src/shared/barcode.ts`, `src/shared/qr.ts`);
  label rolls (1–2 across, named custom sizes) and A4 sheets; header + 4 chosen lines; text shrinks to fit.
- **Excel:** import items and parties from .xlsx/.csv (checked first, then saved in one transaction; blank cells keep
  saved values), templates, export; bulk update grid for prices, GST, HSN, category. Own .xlsx reader/writer (`src/main/xlsx.ts`).
- **Print designs:** Classic / Boxed / Modern / Compact layouts, colour, text size, show/hide switches, footer, default
  terms, UPI payment QR for the balance due; thermal Standard / Itemised (`src/shared/printSettings.ts`).
- **Line details:** batch, Mfg./Exp. dates, model, size, serial per bill line (migration v7, `document_line.details`);
  stock is still per item, not per batch.
- **Switches and own fields:** transport and PO details on bills, time on prints, profit while billing, up to 4 own
  fields for parties and items (migration v8, `extra` columns).
- **Grow:** posters (16 own templates, en/hi/ta, square and tall PNG, clipboard), catalogue PDF, WhatsApp messages
  from bills (PDF kept in Documents\Billing App\Shared) and parties, Google profile helper and review QR poster.
  Online store, ads and Google sign-in are not built: they need servers and accounts.
- Not built: Tally import, reverse charge / composition scheme / TCS / TDS, free quantity, passcode, multi-currency.
