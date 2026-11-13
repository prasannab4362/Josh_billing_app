# Business guides

One guide per kind of business: how to set Josh Billing up for that trade, how to make its everyday bills,
what was checked in the real app, and what the app does not do yet.

| Business | Guide | Checks passed |
|---|---|---|
| Wholesale / distributor | [wholesale.md](wholesale.md) | 10 of 10 |
| Retail shop / general store | [retail.md](retail.md) | 6 of 6 |
| Grocery / kirana | [grocery.md](grocery.md) | 5 of 5 |
| Fish market | [fish-market.md](fish-market.md) | 7 of 7 |
| Services (repairs, IT, consultancy, contractors) | [services.md](services.md) | 6 of 6 |
| Medical shop / pharmacy | [medical-shop.md](medical-shop.md) | 6 of 6 |
| Electrical shop | [electrical-shop.md](electrical-shop.md) | 5 of 5 |
| Stationery / book shop | [stationery.md](stationery.md) | 5 of 5 |
| Jewellery shop (gold and silver) | [jewellery.md](jewellery.md) | 7 of 7 |
| Gold covering / imitation jewellery | [gold-covering.md](gold-covering.md) | 6 of 6 |

All 64 checks passed: 63 across the ten trades plus one for the GST summary report. Checked on 13 Nov 2026.

## How the checks were done

`scripts/e2e/business-check.mjs` runs against the real app (a test profile, never your own data). For each
trade it creates a made-up business set up the way that trade works, adds typical items and customers, and
makes its everyday bills. It then compares every total and GST split with figures worked out separately.
It also checks stock after each sale, payments and balances, the PDF of each bill, and the GST summary.
To run it again:

```bash
npm run build
./node_modules/electron/dist/electron.exe . --remote-debugging-port=9333 --inspect=9334 --user-data-dir=e2e-profile
node scripts/e2e/business-check.mjs e2e-out
```

## Settings every business should look at first

1. **Settings › Business:** name, GSTIN (leave empty if not registered), state, address, logo and signature.
2. **Settings › Preferences:**
   - GST registered or not.
   - Whether prices include tax. Shops selling at MRP usually say yes; wholesalers usually say no.
   - Round off.
   - Default due days.
   - Allow negative stock.
   - Paper size: A4, A5, or thermal 80 mm / 58 mm.
3. **Settings › Units:** add any unit you need that is missing (for example `strip`, `coil`, `ct`).
4. **Settings › Tax rates:** add a rate you need that is not in the list (for example 1.5%).
5. **Settings › Extra fields:** turn on batch / expiry / model / serial / size on bill lines, and rename them
   for your trade (a jeweller can rename "Model no." to "Purity" and "Serial no." to "HUID").
6. **Settings › Transactions:** transport and e-way bill details, customer PO, time on the bill, and profit
   while billing.
7. **Settings › Print:** layout, colour, what to show, a footer line (licence numbers, return policy), and
   default terms.

## A word on GST rates

GST rates were reorganised from 22 September 2025: most goods now fall in the 5% or 18% slabs, with 40% for
luxury and sin goods. Some items keep special rates (3% for gold and imitation jewellery) or are exempt (fresh
fish, loose grains and pulses). Each guide gives the rate commonly used for that trade, but some lists (stationery,
some medicines) changed and sources still disagree. **Confirm every item's rate and HSN code with your CA or
the CBIC notifications before billing.** The app's tax rate list keeps 12% and 28% for older bills; you can
switch off any rate you no longer use in Settings › Tax rates.

## Not built yet (any trade)

- e-invoice (IRN) and e-way bill generation: the app records e-way bill numbers but cannot create them.
- TDS / TCS, reverse charge and the composition scheme.
- Stock per batch, and near-expiry alerts per batch.
- More than one user or passcodes.
- Sync between computers.

Ask before any of these are started: some need online services.
