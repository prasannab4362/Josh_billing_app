# Fish market / fish stall

For fish and seafood sellers: retail stalls, wholesale auctions to hotels and restaurants, dried fish shops.

## What matters in this trade

- Selling **by weight** with prices that **change every morning**.
- Mostly **cash** at the stall, plus **weekly credit** to hotels and caterers.
- **Wastage** and spoilage written off every day.
- Fresh fish is usually **exempt from GST**, and many small sellers are not GST-registered at all.

## Set up

1. Settings › Business: leave **GSTIN empty** if you are not registered.
2. Settings › Preferences: GST registration **off** (or on, if you are registered), paper **Thermal 58 mm**,
   **allow negative stock off** so you never bill more fish than you have.
3. Items: one item per fish, unit `kg`, HSN 0302 (fresh), tax **Exempted**. Put a usual price; you will type
   today's price on the bill.
4. Parties: add hotels with payment terms (for example 7 days).

## GST note

Fresh or chilled fish (HSN 0302) is exempt. Frozen fish (0303) and fillets are 5% when sold pre-packaged and
labelled, and nil when sold loose. Dried, salted or processed fish may have a different rate. Confirm with
your CA.

## Everyday work

| Task | Where |
|---|---|
| Today's price | Type it in the rate box on the bill; the item's saved price is only a starting point |
| Change all prices at once | Items › Bulk update |
| Cash sale | Sale › New invoice, Cash sale, weight with decimals (1.25 kg) |
| Hotel credit | Pick the hotel; the bill stays due; collect with Payments › Payment in |
| Morning purchase at the harbour | Purchase › New purchase from the auction agent |
| Wastage | Items › the fish › Adjust stock › reduce, reason "Spoiled" |

## What was checked in the app (7 of 7 passed)

Example: a Kerala fish stall, not GST-registered.

- Cash sale: 1.25 kg pomfret at ₹680/kg (today's price) and 2 kg sardine at ₹150/kg came to **₹1,150.00**.
  **No GST** was charged.
- A 10 kg sardine sale to a hotel on credit stayed **unpaid** at ₹1,450.
- 1.5 kg of spoiled sardine was written off. Stock: 30 − 2 − 10 − 1.5 = **16.5 kg left**.
- A bill for more pomfret than was in stock was **refused** ("Not enough stock").
- The receipt PDF was made.

## Tips

- The Dashboard's "To receive" card shows what hotels owe at a glance.
- Keep a separate item for each grade or size if prices differ (Prawns large / medium).

## Not built yet

- A daily rate board that changes all prices with one entry. Use Bulk update for now.
- Auction (lot-wise) selling with commission.
