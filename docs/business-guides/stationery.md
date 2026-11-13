# Stationery / book shop

For stationery, school supplies and book shops, and xerox and printing counters.

## What matters in this trade

- **Hundreds of low-price items**: fast billing by barcode matters most.
- Selling **by the box and by the piece**: a box of 10 pens, or 3 loose pens.
- **Different GST rates** in one bill: some school items are nil-rated, others 5% or 18%.
- **School season** bulk orders with a lower price for schools and resellers.

## Set up

1. Settings › Preferences: prices **include tax** (selling at MRP), paper **Thermal 80 mm**.
2. Items: pens with base unit `pcs` and second unit `box` = 10. Books and notebooks in `pcs`.
3. Items: **Wholesale price** and minimum qty for schools (for example ₹8 a pen from 100 pens).
4. Print barcode labels for items without one: select items › **Print labels**. The app first creates
   in-store barcodes for items that have no barcode or code.

## GST note

The September 2025 changes moved several school items (exercise books, pencils, sharpeners, erasers) to
**nil** in some lists, while pens and other stationery stay at 18% or move to 5%. Sources disagree. Check
every item's HSN and rate with your CA and set it per item; the app handles mixed rates on one bill.

## Everyday work

| Task | Where |
|---|---|
| Counter sale | Scan items; walk-in customer; UPI or cash |
| Box and loose | Same item twice: one line in `box`, one in `pcs` |
| School order | Pick the school as the customer; the wholesale price applies from the minimum qty |
| Labels | Items › Print labels (roll or A4 sticker sheet, custom sizes) |
| Xerox / printing | A service item "Photocopy (per page)" with unit `pcs` |

## What was checked in the app (5 of 5 passed)

Example: a Maharashtra stationery shop. A student bought 2 boxes of pens (₹100 a box), 3 loose pens (₹10)
and 6 exercise books (₹45, GST 0%).

- Total **₹500.00** at MRP. Tax was taken only on the pens (CGST ₹17.55 + SGST ₹17.54); the books carried no GST.
- Pen stock fell by **23** (2 boxes × 10 + 3).
- Barcodes were created for the pens and books, and their labels were drawn.
- The receipt PDF was made.

## Tips

- Use Items › **Import from Excel** to bring in your whole price list at once.
- Use **Bulk update** at the start of the school season to change prices and GST rates together.

## Not built yet

- Book sets (one "Class 5 book set" that takes stock from many books).
