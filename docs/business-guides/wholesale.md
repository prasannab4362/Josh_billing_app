# Wholesale / distributor

For businesses that sell in bulk to shops and other businesses: rice and sugar traders, FMCG distributors,
agencies, cloth and hardware wholesalers.

## What matters in this trade

- Selling by the **bag, box or case** while keeping stock in kg or pieces.
- A lower **wholesale price** once a customer buys enough.
- Customers in **other states** (IGST), with their GSTINs printed so they can claim credit.
- **Credit** to regular buyers, with limits and due dates, and part payments.
- **Transport details**: transporter, vehicle number, e-way bill number.
- **Purchase bills** from mills and companies, with the supplier's own bill number.

## Set up

1. Settings › Preferences: GST registered, **prices without tax**, paper **A4**, round off on.
2. Settings › Transactions: turn on **Transport details**.
3. Items: give each item a base unit (kg / pcs) and a **second unit** with how many base units it holds.
   Example: Sugar, base unit `kg`, second unit `bag` = 50 kg.
4. Items: fill in **Wholesale price** and **Minimum qty for wholesale** (in the base unit, e.g. 500 kg).
   The app switches to the wholesale price on its own when the quantity reaches it.
5. Parties: add each buyer's **GSTIN** (the state fills in from it), **credit limit** and **payment terms**.
   The invoice warns you when a sale would take a buyer over the limit.

## Everyday work

| Task | Where |
|---|---|
| Sell 12 bags | Sale › New invoice, pick the item, change the unit to `bag`, qty 12 |
| Buyer in another state | Pick the party; place of supply follows their state, so IGST is charged |
| Freight or loading | Additional charges on the invoice, with its own GST rate |
| Transport and e-way bill no. | The transport boxes on the invoice (printed on the bill) |
| Stock coming in | Purchase › New purchase, with the mill's bill number |
| Part payment | Payments › Payment in, set against the invoice; the rest stays due |
| Who owes what | Reports › Receivables ageing; Parties shows each balance |
| Sales tax return | Reports › GSTR-1 (with portal JSON) and GSTR-3B |

## What was checked in the app (10 of 10 passed)

Example: a Maharashtra distributor selling sugar (5% GST).

- Bought 20 bags at ₹1,950 a bag: total **₹40,950** (CGST ₹975 + SGST ₹975). Stock went from 1,000 kg to 2,000 kg.
- Sold 12 bags at the wholesale rate (₹2,100 a bag) with ₹1,500 freight to a Karnataka retailer: total
  **₹28,035**, all as **IGST ₹1,335**. Stock fell to 1,400 kg.
- The e-way bill number, vehicle number and transporter stayed on the bill.
- A ₹10,000 part payment left the right balance and marked the bill "Partly paid".
- The PDF of the bill was made.

## Tips

- Sell in bags and buy in quintals or tonnes: keep stock in kg and give each pack size its own second unit.
- Use **Items › Bulk update** to change many prices at once when the company revises its rates.
- Print **delivery challans** for goods sent before billing, and convert them to invoices later.

## Not built yet

- Generating e-way bills or e-invoices (IRN) on the government portal. The app records the numbers you get.
- Price lists per customer (party-wise rates). Today there is one sale price and one wholesale price per item.
- Schemes like "buy 10 get 1 free" (free quantity).
