// Document and numbering types.

export const DOC_TYPES = [
  'SALE_INVOICE',
  'SALE_RETURN',
  'ESTIMATE',
  'SALE_ORDER',
  'DELIVERY_CHALLAN',
  'PURCHASE_BILL',
  'PURCHASE_RETURN',
  'PURCHASE_ORDER',
  'EXPENSE'
] as const
export type DocType = (typeof DOC_TYPES)[number]

/** Things that get their own running number (documents plus payments). */
export const NUMBERED_TYPES = [
  'SALE_INVOICE',
  'SALE_RETURN',
  'ESTIMATE',
  'SALE_ORDER',
  'DELIVERY_CHALLAN',
  'PURCHASE_RETURN',
  'PURCHASE_ORDER',
  'PAYMENT_IN',
  'PAYMENT_OUT'
] as const
export type NumberedType = (typeof NUMBERED_TYPES)[number]

export const NUMBERED_LABELS: Record<NumberedType, { label: string; code: string }> = {
  SALE_INVOICE: { label: 'Sale Invoice', code: 'INV' },
  SALE_RETURN: { label: 'Credit Note', code: 'CN' },
  ESTIMATE: { label: 'Estimate / Quotation', code: 'EST' },
  SALE_ORDER: { label: 'Sale Order', code: 'SO' },
  DELIVERY_CHALLAN: { label: 'Delivery Challan', code: 'DC' },
  PURCHASE_RETURN: { label: 'Debit Note', code: 'DN' },
  PURCHASE_ORDER: { label: 'Purchase Order', code: 'PO' },
  PAYMENT_IN: { label: 'Payment In (Receipt)', code: 'RCPT' },
  PAYMENT_OUT: { label: 'Payment Out', code: 'PAY' }
}

export function formatDocNumber(prefix: string, n: number, padding: number): string {
  return prefix + String(n).padStart(padding, '0')
}
