# Josh Billing App

An offline GST billing, inventory and accounts app for Indian small businesses. It runs on Windows as a desktop app
(Electron), and each business is kept in its own SQLite file on the computer, with automatic daily backups.

## Features

- **Sales and purchases:** invoices, estimates, sale/purchase orders, delivery challans, credit and debit notes,
  conversions between them, payments in and out, cash sales.
- **GST:** CGST/SGST/IGST and cess, place of supply, HSN/SAC, tax-inclusive or exclusive prices, GSTR-1 (with portal
  JSON) and GSTR-3B with ITC set-off.
- **Inventory:** items with units and a second unit, opening stock, adjustments, stock summary, low-stock alerts.
- **Barcodes and QR codes:** create in-store EAN-13 barcodes, print labels (label rolls or A4 sheets, custom sizes,
  chosen lines), scan into bills.
- **Excel:** import items and parties (checked before saving), export, and bulk update prices and GST.
- **Printing:** A4/A5 layouts (Classic, Boxed, Modern, Compact), thermal 58/80 mm receipts, colours, show/hide
  switches, logo and signature, UPI payment QR code for the amount due.
- **Extra details:** batch, Mfg./Exp. dates, model, size, serial on bill lines; transport and e-way bill details;
  customer PO; up to four fields of your own for parties and items.
- **Accounts and reports:** double-entry ledger, cash and bank, expenses, day book, party statements, ageing,
  profit and loss, GST summary, item sales; print, PDF and CSV.
- **Grow your business:** posters for greetings, festivals, offers and products (English, Hindi, Tamil) saved as
  images or copied for WhatsApp; product catalogue PDF; WhatsApp messages for bills and payment reminders; Google
  Business Profile helper with a "Review us" QR poster. All made offline; WhatsApp opens with the text ready.
- **Data safety:** backups and restore, recycle bin, change history; several businesses per computer.

## Development

Needs Node.js 20 or later.

```bash
npm install        # also rebuilds better-sqlite3 for Electron
npm run dev        # run the app with live reload
npm test           # unit tests (run inside Electron's Node)
npm run typecheck
npm run build      # production build in out/
```

Code layout:

- `src/main` — Electron main process: database, migrations, services, printing, IPC handlers
- `src/renderer` — React screens
- `src/shared` — code used by both: models, GST maths, invoice and label HTML, barcode and QR encoders

See `DESIGN.md` for the data model and design decisions, and `AGENTS.md` for the rules every change must keep
(also read by coding agents). End-to-end checks of the running app are in `scripts/e2e/`. Money is stored as integer paise, quantities as
milli-units, and rates as basis points, so no amount is ever a floating-point number.
