# Services business

For businesses that sell work rather than goods: IT support, repairs and maintenance, consultants,
contractors, salons, courier and transport agents, event services.

## What matters in this trade

- Billing **hours, visits, jobs or a fixed fee**, with no stock.
- **SAC codes** instead of HSN, usually at **18% GST**.
- **Quotations** first, then an invoice when the client agrees.
- Clients in other states (IGST), and payment terms of 15 or 30 days.

## Set up

1. Settings › Preferences: GST registered, prices **without tax**, paper **A4**.
2. Items: each service as an item of type **Service** (no stock), with its **SAC** code in HSN/SAC, the
   unit `hr`, `day`, `job` or `nos`, and the GST rate.
3. Parties: client GSTIN (state fills in), payment terms.
4. Settings › Print: default terms (payment terms, bank details), and a UPI QR for quick payment.

## Everyday work

| Task | Where |
|---|---|
| Quote a price | Sale › Estimates / quotations › New estimate |
| Client agrees | Open the estimate › Convert to invoice (the estimate is marked Converted) |
| Bill hours | Item "IT support (per hour)", qty 6 |
| Visit or travel charges | Additional charges, with 18% GST |
| Discount on a line | Disc % column |
| Track what's due | Dashboard › Overdue invoices; Reports › Receivables ageing |
| Your running costs | Expenses (rent, salaries, travel, phone), with GST credit |

## What was checked in the app (6 of 6 passed)

Example: a Karnataka IT service company billing a Maharashtra client.

- 6 hours at ₹800 + an AMC of ₹12,000 with 10% off + ₹500 visit charges came to **₹18,998.00**, all as
  **IGST ₹2,898** (inter-state).
- Services did **not** create any stock.
- A quotation was saved, then converted into an invoice of ₹14,160 (₹12,000 + 18%). The quotation became
  "Converted".
- The invoice PDF was made.

## Tips

- Monthly retainers: keep a fixed item "Retainer (monthly)" and make a new invoice with it each month (recurring
  invoices are not built yet).
- Expenses with GST (for example rent from a registered landlord) count as input credit in GSTR-3B.

## Not built yet

- **TDS**: clients often deduct 2% or 10% TDS. Record the amount actually received as the payment, and note
  the TDS in the payment notes. TDS tracking is not built.
- Recurring (automatic monthly) invoices.
- Time sheets.
