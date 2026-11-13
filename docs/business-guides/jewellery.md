# Jewellery shop (gold and silver)

For jewellers selling gold, silver and diamond jewellery, and taking old gold in exchange.

## What matters in this trade

- Selling **by weight in grams to the milligram** (4.250 g) at **today's rate per gram**.
- **Purity** (22K / 916, 18K) and the **HUID** hallmark number on each piece.
- **Making charges**, shown separately with their own GST, plus hallmarking charges.
- **Old gold exchange**: the customer's old gold is set off against the new bill.
- High-value bills with UPI, card and cheque payments, often on one bill.

## Set up

1. Settings › Preferences: GST registered, prices **without tax**, paper **A4**, round off on.
2. Settings › Extra fields: turn on and rename
   - **Model no.** → **Purity**
   - **Serial no.** → **HUID**
   - **Size** → **Gross wt.** (stone-inclusive weight)
3. Items: one item per product type and purity (Gold Ring 22K, Gold Chain 22K, Silver Anklet), unit `g`,
   HSN **7113**, GST **3%**. The sale price is the rate per gram.
4. Items: "Old gold (exchange)" with unit `g` and **no GST**.
5. Parties: add regular customers as **Both** (customer and supplier) so old gold can be bought from them.

## GST note

Gold, silver and diamond jewellery (HSN 7113) is taxed at **3%** on the value of the metal and the making.
Many jewellers show making charges separately; sources differ on whether a separate rate (5%) applies when
making is billed apart from the jewellery. Confirm the treatment with your CA. Old gold bought from a person
who is not GST-registered carries no GST.

## Everyday work

| Task | Where |
|---|---|
| Today's gold rate | Type it as the rate on each line, or update all items with Items › Bulk update |
| Weight | Qty in grams with three decimals: 4.250 |
| Purity, HUID, gross weight | The boxes under each line |
| Making and hallmarking | Additional charges, each with its GST rate |
| Old gold exchange | Purchase › New purchase from the same customer, item "Old gold", weight × rate |
| Set the exchange off | The customer's balance is the new bill less the old gold; take the rest as a payment |
| Split payment | Payment in more than once (UPI + card + cash) against the same bill |

## What was checked in the app (7 of 7 passed)

Example: a Tamil Nadu jeweller. A 22K ring of 4.250 g and a 22K chain of 12.380 g at ₹7,250/g, plus ₹13,500
making charges (5%) and ₹90 hallmarking (18%).

- Total **₹1,38,466.00** (CGST ₹2,154.12 + SGST ₹2,154.11).
- Chain stock was kept to the milligram: 250 g − 12.380 g = **237.620 g** left.
- Purity "22K (916)", HUID and gross weight printed under each piece.
- 8 g of old gold at ₹6,600/g taken in as a purchase: **₹52,800, no GST**.
- The customer's balance came to the sale less the old gold value.
- The invoice PDF was made.

## Tips

- Weights print without trailing zeros (12.380 g prints as 12.38 g); the full weight is kept and used in
  every calculation.
- Use Grow › Posters for festival offers (Akshaya Tritiya, Diwali, wedding season).

## Not built yet

- A daily gold rate board that reprices every item at once (use Bulk update meanwhile).
- Making charges worked out automatically as a % or per gram. Enter the making amount as a charge.
- Net weight and stone weight with separate stone value columns, and wastage %.
- Gold savings schemes and girvi (pledge) records.
