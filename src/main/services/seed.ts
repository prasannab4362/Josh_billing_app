// Defaults every new business starts with.

import type { TaxKind } from '@shared/models'

export const DEFAULT_UNITS: { short: string; name: string }[] = [
  { short: 'pcs', name: 'Pieces' },
  { short: 'nos', name: 'Numbers' },
  { short: 'box', name: 'Box' },
  { short: 'pkt', name: 'Packet' },
  { short: 'dzn', name: 'Dozen' },
  { short: 'set', name: 'Set' },
  { short: 'pair', name: 'Pair' },
  { short: 'kg', name: 'Kilogram' },
  { short: 'g', name: 'Gram' },
  { short: 'qtl', name: 'Quintal' },
  { short: 'ton', name: 'Tonne' },
  { short: 'ltr', name: 'Litre' },
  { short: 'ml', name: 'Millilitre' },
  { short: 'm', name: 'Metre' },
  { short: 'cm', name: 'Centimetre' },
  { short: 'ft', name: 'Feet' },
  { short: 'sqft', name: 'Square feet' },
  { short: 'bag', name: 'Bag' },
  { short: 'btl', name: 'Bottle' },
  { short: 'roll', name: 'Roll' },
  { short: 'hr', name: 'Hour' },
  { short: 'day', name: 'Day' },
  { short: 'job', name: 'Job' }
]

export const DEFAULT_TAX_RATES: { name: string; kind: TaxKind; rateBp: number }[] = [
  { name: 'GST 0%', kind: 'gst', rateBp: 0 },
  { name: 'GST 0.25%', kind: 'gst', rateBp: 25 },
  { name: 'GST 3%', kind: 'gst', rateBp: 300 },
  { name: 'GST 5%', kind: 'gst', rateBp: 500 },
  { name: 'GST 12%', kind: 'gst', rateBp: 1200 },
  { name: 'GST 18%', kind: 'gst', rateBp: 1800 },
  { name: 'GST 28%', kind: 'gst', rateBp: 2800 },
  { name: 'GST 40%', kind: 'gst', rateBp: 4000 },
  { name: 'Exempted', kind: 'exempt', rateBp: 0 },
  { name: 'Nil rated', kind: 'nil', rateBp: 0 },
  { name: 'Non-GST', kind: 'non_gst', rateBp: 0 }
]

export const CASH_ACCOUNT_ID = 'cash'
