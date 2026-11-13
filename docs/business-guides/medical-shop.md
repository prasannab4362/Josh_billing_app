# Medical shop / pharmacy

For chemists and druggists: retail pharmacies, hospital pharmacies, medical wholesalers.

## What matters in this trade

- **Batch number and expiry date** on every line of the bill.
- Selling by the **strip** and by **loose tablets** from the same stock.
- **MRP** prices with GST inside.
- **Drug licence numbers** printed on the bill.
- Doctor's name or prescription reference on the bill when required.

## Set up

1. Settings › Preferences: GST registered, prices **include tax**, paper **A5** or thermal.
2. Settings › Extra fields: turn on **Batch no.** and **Exp. date** (expiry format month/year).
3. Settings › Print › Footer: your licence numbers, for example
   `D.L. No. 20B-XX-0000, 21B-XX-0000 · Medicines once sold are taken back only with the bill`.
4. Settings › Units: add `tab` (Tablet) and `strip` (Strip) if they are missing.
5. Items: base unit `tab`, second unit `strip` = 10 or 15 tablets. Enter the MRP per tablet as the sale price
   (tick "includes tax"), HSN 3004.

## GST note

Since 22 September 2025 most medicines are taxed at **5%**, and some life-saving drugs are exempt. Sources
differ on which drugs are nil-rated, so check each product with your CA or distributor's invoice.

## Everyday work

| Task | Where |
|---|---|
| Sell 2 strips | Pick the item, unit `strip`, qty 2 |
| Sell loose tablets | Same item, unit `tab`, qty 5 |
| Batch and expiry | The boxes under each line (turned on in Extra fields) |
| Doctor / Rx | Notes on the bill |
| Purchase from a distributor | Purchase bill with the distributor's bill number, batch and expiry |
| Return | Sale return against the invoice (needs the customer's name) |
| Near-expiry check | See "Not built yet" below |

## What was checked in the app (6 of 6 passed)

Example: a Maharashtra pharmacy. A patient bought 2 strips of paracetamol 650 (₹45 a strip of 15),
5 loose tablets (₹3 each) and 1 cough syrup (₹118), all at MRP with 5% GST included.

- Total **₹223.00**, exactly the MRP total (CGST ₹5.32 + SGST ₹5.30).
- Tablet stock fell by **35** (2 strips × 15 + 5 loose).
- Batch and expiry stayed on every line and printed as "Batch no.: PCM2401 · Exp. date: 08/2027".
- A sale return for a walk-in (no name) was **refused**: returns need the customer's name.
- The licence numbers printed in the footer of the PDF.

## Tips

- Add the patient as a party if they want a named bill (insurance claims, returns).
- Use Items › Print labels for shelf labels with MRP.

## Not built yet

- **Stock per batch** and **near-expiry alerts**. Batch and expiry are printed on bills, but stock is counted
  per item, not per batch. This is listed as an open decision for the owner.
- Schedule H / H1 register.
