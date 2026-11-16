# Plan: desktop and website, one set of data

Goal: the shop's data lives in two places at once (the desktop app and a website), neither can lose it, and both show
the same bills, stock and balances. Written 16 November 2026. Nothing here is built yet; the choices marked **DECIDE**
need the owner.

## What the app already has that makes this possible

- Every record has a UUID, so two computers can create records without clashing.
- Parties, items, bills and payments have `updated_at` and soft-delete (`deleted_at`), so "what changed since" and
  "this was deleted" are both known.
- Stock, balances and the ledger are **derived** (`stock_movement`, `ledger_entry`, `item_stock`, payment allocations).
  They never need to be copied: the receiving side rebuilds them by saving the same bill through the same code.
- Backups are verified files, and a second copy folder already exists.

## What makes it hard (and the answer to each)

| Problem | Answer |
|---|---|
| Two places both issue "INV/26-27/15" | Each device issues numbers from its own series (a device letter in the prefix, e.g. `INV/26-27/W-0007`), or the server hands out the next number when online. Never let two devices share one counter. |
| Two people edit the same party or bill | Last change wins per record, but a bill that was paid or returned on the other side is not overwritten silently: it is kept as a conflict for the owner to pick. Bills are synced whole, never line by line. |
| Stock goes negative because two places sold the last piece | Allowed (the app already allows negative stock with a warning); the owner sees it in the stock report. |
| A bill deleted on one side | Soft-deleted everywhere (recycle bin), so it can come back. |
| Money maths must be identical | The server runs the **same** shared code (`src/shared/tax.ts`, `pos.ts`, `invoiceHtml.ts`) as the desktop. No second copy of the rules. |
| Privacy of shop data on a server | Data is encrypted in transit; stored per business; the owner can export or delete everything; backups are separate from the server. See "Security" below. |

## Options

**A. Backup folder only (built).** Data in two places through the second-copy folder. No website. Free. Restores
manually. Good enough for "never lose it", not for "see it from my phone".

**B. Read-only website (a view of the shop).** The desktop pushes a snapshot of reports and balances after each change
(or every few minutes). The website shows today's sales, who owes what, stock, and lets the owner download bills as
PDF. Nobody can enter data on the website, so there is nothing to conflict. Smallest server, lowest risk, shows
phone-friendly numbers to the owner while away from the shop. About 2 weeks of work.

**C. Full website with billing (two-way sync).** The website can make bills, take payments and edit items; changes flow
both ways. Needs the numbering, conflict and login work above and much more testing. About 2 to 3 months of work, and a
server that must be kept running and updated.

**Recommendation: A now (done), then B, then C only if the shop really needs billing from the website.** B gives
"I can see my shop and my data is in two places" with almost none of the risk of C.

## How B would work

1. **Sign in on the desktop to the owner's online account** (email and password, or a code by email). The desktop gets a
   key that belongs to this business only.
2. **Push:** after each saved bill, payment or item change the desktop sends a small, signed update (the whole
   changed record, nothing derived). If the internet is down it queues them and sends later, in order. Nothing is lost
   or sent twice (each update has the record's UUID and its `updated_at`).
3. **Server:** keeps one database per business, rebuilds the same reports with the shared code, and answers the website.
4. **Website:** sign in, dashboard, bills list with PDF, party balances, stock, GST summary. Phone-friendly.
5. **Restore from the server:** a new computer signs in and pulls everything down: the data never depends on one disk.

For C, step 2 becomes two-way: the website's changes are pulled by the desktop the same way, with the numbering and
conflict rules in the table above.

## Security (for B and C)

- Passwords stored as salted scrypt hashes (as the desktop does); optional second step by email code.
- One key per business; a staff login on the website sees only what staff see on the desktop (same role list).
- Everything over HTTPS; the server database encrypted at rest; daily server backups kept in a different place.
- The owner can export every record and delete the online copy with one button.
- The desktop stays the master copy: it works with no internet, and the website can be switched off at any time
  without losing anything.

## Running cost and who does what (**DECIDE**)

- A small server and database: roughly ₹500 to ₹1,500 a month for one to ten shops; more as shops are added.
- Someone must own the server: renew it, apply security updates, watch backups. That is the owner, or a company the
  owner pays.
- A domain name (about ₹800 a year) and an email service for sign-in codes.

## Decisions made (16 November 2026)

- The website starts as **view only** (option B). Full billing on the website (option C) is not planned.
- **Hosting is not decided yet.** Nothing is built until it is: the server's address, account and bill must belong to the
  owner (or a company the owner chooses).

## Decisions still needed

1. **What should the website do first?** View only (B), or billing too (C).
2. **Who hosts it?** The owner's own cloud account (cheapest, owner pays and controls), or a managed host.
3. **One shop or many?** If many shops (customers), each needs its own account, billing for the service and a support
   process: that is a business, not only a feature.
4. **Staff on the website?** Owner only, or staff logins as on the desktop.
5. **Languages:** English only, or English, Hindi and Tamil like the posters.

## Steps for B (when decided)

1. Server skeleton: accounts, one database per business, health checks, backups. Shared code package.
2. Desktop: sign-in, key storage, offline queue, "Online copy" screen (status, last sent, send now, turn off).
3. Server: receive and verify updates; rebuild reports; tests that the server's totals equal the desktop's for the
   same data (reuse the 150-bill agreement test).
4. Website: dashboard, bills, parties, stock, GST; phone layout; PDF.
5. Security review, restore drill (a new computer pulls everything), then a pilot with one shop.
