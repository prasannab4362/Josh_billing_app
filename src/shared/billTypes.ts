// Every kind of bill-like document, and how each one behaves. Shared by the screens and the
// main process so wording and rules never drift apart.

export const BILL_TYPES = [
  'SALE_INVOICE',
  'SALE_RETURN',
  'ESTIMATE',
  'SALE_ORDER',
  'DELIVERY_CHALLAN',
  'PURCHASE_BILL',
  'PURCHASE_RETURN',
  'PURCHASE_ORDER'
] as const
export type BillType = (typeof BILL_TYPES)[number]

export interface BillInfo {
  /** Which way goods go: sales use sale prices and the customer's state, purchases the supplier's. */
  side: 'sale' | 'purchase'
  /** Posts to the ledger, moves stock and can take money. Quotes, orders and challans do not. */
  posts: boolean
  /** +1 when the party ends up owing us (invoice, debit note); −1 when we owe them. */
  sign: 1 | -1
  /** Numbered from our own series (purchase bills carry the supplier's number instead). */
  numbered: boolean
  /** Can be made out to a walk-in customer without choosing a party. */
  walkIn: boolean
  noun: string
  plural: string
  printTitle: string
  newLabel: string
  /** Word for money settled with it: received, paid, refunded. */
  paidWord: string
  /** Kinds this one can be turned into. */
  convertsTo: BillType[]
  /** The bill a return is made against. */
  returnOf: BillType | null
}

export const BILL_INFO: Record<BillType, BillInfo> = {
  SALE_INVOICE: {
    side: 'sale', posts: true, sign: 1, numbered: true, walkIn: true, noun: 'Invoice', plural: 'Sale invoices',
    printTitle: 'TAX INVOICE', newLabel: '+ New invoice', paidWord: 'Received', convertsTo: [], returnOf: null
  },
  SALE_RETURN: {
    side: 'sale', posts: true, sign: -1, numbered: true, walkIn: false, noun: 'Credit note', plural: 'Credit notes (sale returns)',
    printTitle: 'CREDIT NOTE', newLabel: '+ New credit note', paidWord: 'Refunded', convertsTo: [], returnOf: 'SALE_INVOICE'
  },
  ESTIMATE: {
    side: 'sale', posts: false, sign: 1, numbered: true, walkIn: true, noun: 'Estimate', plural: 'Estimates / quotations',
    printTitle: 'ESTIMATE', newLabel: '+ New estimate', paidWord: '', convertsTo: ['SALE_ORDER', 'SALE_INVOICE'], returnOf: null
  },
  SALE_ORDER: {
    side: 'sale', posts: false, sign: 1, numbered: true, walkIn: true, noun: 'Sale order', plural: 'Sale orders',
    printTitle: 'SALE ORDER', newLabel: '+ New sale order', paidWord: '', convertsTo: ['SALE_INVOICE'], returnOf: null
  },
  DELIVERY_CHALLAN: {
    side: 'sale', posts: false, sign: 1, numbered: true, walkIn: true, noun: 'Delivery challan', plural: 'Delivery challans',
    printTitle: 'DELIVERY CHALLAN', newLabel: '+ New challan', paidWord: '', convertsTo: ['SALE_INVOICE'], returnOf: null
  },
  PURCHASE_BILL: {
    side: 'purchase', posts: true, sign: -1, numbered: false, walkIn: false, noun: 'Bill', plural: 'Purchase bills',
    printTitle: 'PURCHASE BILL', newLabel: '+ New purchase', paidWord: 'Paid', convertsTo: [], returnOf: null
  },
  PURCHASE_RETURN: {
    side: 'purchase', posts: true, sign: 1, numbered: true, walkIn: false, noun: 'Debit note', plural: 'Debit notes (purchase returns)',
    printTitle: 'DEBIT NOTE', newLabel: '+ New debit note', paidWord: 'Refund received', convertsTo: [], returnOf: 'PURCHASE_BILL'
  },
  PURCHASE_ORDER: {
    side: 'purchase', posts: false, sign: -1, numbered: true, walkIn: false, noun: 'Purchase order', plural: 'Purchase orders',
    printTitle: 'PURCHASE ORDER', newLabel: '+ New purchase order', paidWord: '', convertsTo: ['PURCHASE_BILL'], returnOf: null
  }
}

/** The tabs under Sale and Purchase in the sidebar. */
export const SALE_TYPES: BillType[] = ['SALE_INVOICE', 'ESTIMATE', 'SALE_ORDER', 'DELIVERY_CHALLAN', 'SALE_RETURN']
export const PURCHASE_TYPES: BillType[] = ['PURCHASE_BILL', 'PURCHASE_ORDER', 'PURCHASE_RETURN']

/** Money direction for cash taken or paid while saving a posting bill. */
export const payDirection = (t: BillType): 'in' | 'out' => (BILL_INFO[t].sign > 0 ? 'in' : 'out')
