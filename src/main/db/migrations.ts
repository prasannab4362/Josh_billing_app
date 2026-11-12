// Ordered schema migrations. Never edit a shipped migration; add a new one.
// Money columns are integer paise, quantities integer milli-units, rates basis points.

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
-- ---------- Business setup ----------
CREATE TABLE business (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  legal_name      TEXT,
  gstin           TEXT,
  pan             TEXT,
  state_code      TEXT NOT NULL,
  address         TEXT,
  city            TEXT,
  pincode         TEXT,
  phone           TEXT,
  email           TEXT,
  logo_path       TEXT,
  signature_path  TEXT,
  business_type   TEXT,
  category        TEXT,
  fy_start_month  INTEGER NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  currency        TEXT NOT NULL DEFAULT 'INR',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE bank_account (
  id                   TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN ('cash','bank','upi_wallet')),
  name                 TEXT NOT NULL,
  bank_name            TEXT,
  account_no           TEXT,
  ifsc                 TEXT,
  upi_id               TEXT,
  opening_balance      INTEGER NOT NULL DEFAULT 0,
  opening_date         TEXT,
  is_default_for_print INTEGER NOT NULL DEFAULT 0,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,          -- JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE number_series (
  id          TEXT PRIMARY KEY,
  doc_type    TEXT NOT NULL,
  prefix      TEXT NOT NULL DEFAULT '',
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  padding     INTEGER NOT NULL DEFAULT 0,
  fy          TEXT,                  -- e.g. '2025-26'; NULL = not FY-based
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (doc_type, prefix, fy)
);

CREATE TABLE tax_rate (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('gst','exempt','nil','non_gst')),
  rate_bp    INTEGER NOT NULL DEFAULT 0 CHECK (rate_bp >= 0),
  cess_bp    INTEGER NOT NULL DEFAULT 0 CHECK (cess_bp >= 0),
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ---------- Masters ----------
CREATE TABLE party_group (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE party (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  display_name      TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('customer','supplier','both')),
  phone             TEXT,
  email             TEXT,
  gstin             TEXT,
  state_code        TEXT,
  billing_address   TEXT,
  shipping_address  TEXT,
  opening_balance   INTEGER NOT NULL DEFAULT 0,   -- + receivable, - payable
  opening_date      TEXT,
  credit_limit      INTEGER,
  payment_term_days INTEGER,
  group_id          TEXT REFERENCES party_group(id),
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX idx_party_name ON party(name);
CREATE INDEX idx_party_phone ON party(phone);

CREATE TABLE unit (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  short TEXT NOT NULL UNIQUE
);

CREATE TABLE item_category (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE item (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  code               TEXT,
  kind               TEXT NOT NULL CHECK (kind IN ('goods','service')),
  category_id        TEXT REFERENCES item_category(id),
  hsn_sac            TEXT,
  tax_rate_id        TEXT REFERENCES tax_rate(id),
  price_includes_tax INTEGER NOT NULL DEFAULT 0,
  sale_price         INTEGER NOT NULL DEFAULT 0,
  purchase_price     INTEGER NOT NULL DEFAULT 0,
  mrp                INTEGER,
  wholesale_price    INTEGER,
  wholesale_min_qty  INTEGER,
  base_unit_id       TEXT REFERENCES unit(id),
  alt_unit_id        TEXT REFERENCES unit(id),
  alt_conversion     INTEGER,                      -- milli base units per 1 alt unit
  track_stock        INTEGER NOT NULL DEFAULT 1,
  opening_qty        INTEGER NOT NULL DEFAULT 0,
  opening_rate       INTEGER NOT NULL DEFAULT 0,
  low_stock_qty      INTEGER,
  track_batch        INTEGER NOT NULL DEFAULT 0,
  track_serial       INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX idx_item_name ON item(name);
CREATE UNIQUE INDEX idx_item_code ON item(code) WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE party_price (
  party_id       TEXT NOT NULL REFERENCES party(id),
  item_id        TEXT NOT NULL REFERENCES item(id),
  sale_price     INTEGER,
  purchase_price INTEGER,
  PRIMARY KEY (party_id, item_id)
);

-- ---------- Documents ----------
CREATE TABLE document (
  id                 TEXT PRIMARY KEY,
  doc_type           TEXT NOT NULL CHECK (doc_type IN (
                       'SALE_INVOICE','SALE_RETURN','ESTIMATE','SALE_ORDER','DELIVERY_CHALLAN',
                       'PURCHASE_BILL','PURCHASE_RETURN','PURCHASE_ORDER','EXPENSE')),
  number             TEXT,
  series_id          TEXT REFERENCES number_series(id),
  date               TEXT NOT NULL,
  due_date           TEXT,
  party_id           TEXT REFERENCES party(id),
  party_snapshot     TEXT,                         -- JSON
  place_of_supply    TEXT,
  supply_type        TEXT CHECK (supply_type IN ('intra','inter')),
  prices_include_tax INTEGER NOT NULL DEFAULT 0,
  subtotal           INTEGER NOT NULL DEFAULT 0,
  discount_total     INTEGER NOT NULL DEFAULT 0,
  taxable_total      INTEGER NOT NULL DEFAULT 0,
  cgst               INTEGER NOT NULL DEFAULT 0,
  sgst               INTEGER NOT NULL DEFAULT 0,
  igst               INTEGER NOT NULL DEFAULT 0,
  cess               INTEGER NOT NULL DEFAULT 0,
  charges_total      INTEGER NOT NULL DEFAULT 0,
  round_off          INTEGER NOT NULL DEFAULT 0,
  grand_total        INTEGER NOT NULL DEFAULT 0,
  paid_amount        INTEGER NOT NULL DEFAULT 0,
  balance_due        INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft',
  notes              TEXT,
  terms              TEXT,
  source_doc_id      TEXT REFERENCES document(id),
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX idx_document_type_date ON document(doc_type, date);
CREATE INDEX idx_document_party ON document(party_id);
CREATE UNIQUE INDEX idx_document_number ON document(doc_type, number)
  WHERE number IS NOT NULL AND doc_type NOT IN ('PURCHASE_BILL','EXPENSE');

CREATE TABLE document_line (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  item_id         TEXT REFERENCES item(id),
  description     TEXT,
  qty             INTEGER NOT NULL,
  unit_id         TEXT REFERENCES unit(id),
  unit_factor     INTEGER NOT NULL DEFAULT 1000,   -- milli base units per 1 line unit
  rate            INTEGER NOT NULL,
  discount_pct_bp INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  taxable_amount  INTEGER NOT NULL,
  tax_rate_id     TEXT REFERENCES tax_rate(id),
  tax_rate_bp     INTEGER NOT NULL DEFAULT 0,
  cgst            INTEGER NOT NULL DEFAULT 0,
  sgst            INTEGER NOT NULL DEFAULT 0,
  igst            INTEGER NOT NULL DEFAULT 0,
  cess            INTEGER NOT NULL DEFAULT 0,
  line_total      INTEGER NOT NULL,
  hsn_sac         TEXT,
  batch_no        TEXT,
  UNIQUE (document_id, line_no)
);

CREATE TABLE document_charge (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  tax_rate_id TEXT REFERENCES tax_rate(id),
  tax_amount  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE document_link (
  from_doc_id TEXT NOT NULL REFERENCES document(id),
  to_doc_id   TEXT NOT NULL REFERENCES document(id),
  kind        TEXT NOT NULL CHECK (kind IN ('converted','returned_against')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (from_doc_id, to_doc_id)
);

-- ---------- Money ----------
CREATE TABLE payment (
  id         TEXT PRIMARY KEY,
  direction  TEXT NOT NULL CHECK (direction IN ('in','out')),
  number     TEXT,
  date       TEXT NOT NULL,
  party_id   TEXT REFERENCES party(id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  account_id TEXT NOT NULL REFERENCES bank_account(id),
  mode       TEXT NOT NULL CHECK (mode IN ('cash','upi','bank','cheque','card')),
  reference  TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_payment_party ON payment(party_id);

CREATE TABLE payment_allocation (
  payment_id  TEXT NOT NULL REFERENCES payment(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES document(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, document_id)
);

CREATE TABLE cheque (
  payment_id  TEXT PRIMARY KEY REFERENCES payment(id) ON DELETE CASCADE,
  cheque_no   TEXT NOT NULL,
  cheque_date TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','deposited','bounced')),
  updated_at  TEXT NOT NULL
);

CREATE TABLE account_transfer (
  id              TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL REFERENCES bank_account(id),
  to_account_id   TEXT NOT NULL REFERENCES bank_account(id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  date            TEXT NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  deleted_at      TEXT,
  CHECK (from_account_id <> to_account_id)
);

-- ---------- Ledger (source of truth for balances) ----------
CREATE TABLE ledger_entry (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('document','payment','opening','transfer','adjustment')),
  source_id   TEXT NOT NULL,
  account     TEXT NOT NULL,                       -- 'party:<id>', 'bank:<id>', 'sales', 'gst_out', ...
  debit       INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_ledger_account_date ON ledger_entry(account, date);
CREATE INDEX idx_ledger_source ON ledger_entry(source_type, source_id);

-- ---------- Stock ----------
CREATE TABLE stock_adjustment (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  item_id    TEXT NOT NULL REFERENCES item(id),
  qty_change INTEGER NOT NULL,
  rate       INTEGER NOT NULL DEFAULT 0,
  reason     TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE stock_movement (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  item_id     TEXT NOT NULL REFERENCES item(id),
  qty_change  INTEGER NOT NULL,                    -- milli base units, + in / - out
  rate        INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL CHECK (source_type IN ('document','adjustment','opening')),
  source_id   TEXT NOT NULL,
  location_id TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_stock_item_date ON stock_movement(item_id, date);
CREATE INDEX idx_stock_source ON stock_movement(source_type, source_id);

-- Rebuildable caches
CREATE TABLE item_stock (
  item_id TEXT PRIMARY KEY REFERENCES item(id),
  qty     INTEGER NOT NULL DEFAULT 0,
  value   INTEGER NOT NULL DEFAULT 0
);

-- ---------- System ----------
CREATE TABLE app_user (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  role       TEXT NOT NULL DEFAULT 'owner',
  pin_hash   TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete','restore')),
  before_json TEXT,
  after_json  TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
`
  },
  {
    version: 2,
    name: 'item opening date',
    sql: `ALTER TABLE item ADD COLUMN opening_date TEXT;`
  },
  {
    version: 3,
    name: 'payment taken while billing',
    sql: `ALTER TABLE payment ADD COLUMN source_doc_id TEXT REFERENCES document(id);
CREATE INDEX idx_payment_source_doc ON payment(source_doc_id);`
  },
  {
    version: 4,
    name: 'cash and bank opening balances in the ledger',
    sql: `
INSERT INTO ledger_entry (id, date, source_type, source_id, account, debit, credit, created_at)
SELECT lower(hex(randomblob(16))), COALESCE(opening_date, substr(created_at, 1, 10)), 'opening', id, 'opening_equity',
       max(-opening_balance, 0), max(opening_balance, 0), created_at
FROM bank_account b WHERE opening_balance <> 0
  AND NOT EXISTS (SELECT 1 FROM ledger_entry e WHERE e.source_type = 'opening' AND e.source_id = b.id);
INSERT INTO ledger_entry (id, date, source_type, source_id, account, debit, credit, created_at)
SELECT lower(hex(randomblob(16))), COALESCE(opening_date, substr(created_at, 1, 10)), 'opening', id, 'bank:' || id,
       max(opening_balance, 0), max(-opening_balance, 0), created_at
FROM bank_account b WHERE opening_balance <> 0
  AND NOT EXISTS (SELECT 1 FROM ledger_entry e WHERE e.source_type = 'opening' AND e.source_id = b.id AND e.account = 'bank:' || b.id);
CREATE INDEX idx_transfer_date ON account_transfer(date);
`
  },
  {
    version: 5,
    name: 'returns, conversions and expenses',
    sql: `
-- Amount of a credit/debit note set off against the bill it returns (0 for conversions).
ALTER TABLE document_link ADD COLUMN amount INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_document_link_to ON document_link(to_doc_id);
-- Expenses: what kind of expense, and the cash/bank account it was paid from.
ALTER TABLE document ADD COLUMN category TEXT;
ALTER TABLE document ADD COLUMN account_id TEXT REFERENCES bank_account(id);
`
  },
  {
    version: 6,
    name: 'item description, barcode and photo',
    sql: `
-- business.logo_path and signature_path (from v1) now hold the images themselves, as data URLs,
-- so they travel inside backups.
ALTER TABLE item ADD COLUMN description TEXT;
ALTER TABLE item ADD COLUMN barcode TEXT;
ALTER TABLE item ADD COLUMN image TEXT;
CREATE UNIQUE INDEX idx_item_barcode ON item(barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
`
  },
  {
    version: 7,
    name: 'item details on bill lines',
    sql: `
-- Batch, Mfg./Exp. dates, model, size and serial number typed on a bill line, as JSON.
ALTER TABLE document_line ADD COLUMN details TEXT;
`
  },
  {
    version: 8,
    name: 'transport and PO details, own fields for parties and items',
    sql: `
-- JSON: transport and purchase-order details of a bill; values of the business's own fields.
ALTER TABLE document ADD COLUMN extra TEXT;
ALTER TABLE party ADD COLUMN extra TEXT;
ALTER TABLE item ADD COLUMN extra TEXT;
`
  }
]
