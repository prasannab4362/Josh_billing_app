import { describe, expect, it } from 'vitest'
import { invoiceHtml } from './invoiceHtml'
import type { Business, Invoice } from './models'
import { EMPTY_TEST_PROFILE } from './testFixtures'

const business: Business = { ...EMPTY_TEST_PROFILE, id: 'b', logo: '', signature: '', name: 'Shop & Co', stateCode: '27', gstin: '27AAPFU0939F1ZV', createdAt: '', updatedAt: '' }
const line = {
  id: 'l1', itemId: 'i', itemName: 'Pen', itemDescription: '', itemCustomFields: null, description: 'Pen <blue>', qty: 2000, unitId: 'u', unitShort: 'pcs', unitFactor: 1000,
  rate: 1000, discountPctBp: 0, discountAmount: 0, taxRateId: 't', taxRateBp: 1800, cessBp: 0, hsnSac: '9608',
  taxable: 2000, cgst: 180, sgst: 180, igst: 0, cess: 0, total: 2360
}
const invoice: Invoice = {
  id: 'd', type: 'SALE_INVOICE', links: [], extra: null, number: 'INV/25-26/1', date: '2025-07-10', dueDate: '2025-07-25', partyId: 'p', partyName: 'Ravi',
  grandTotal: 2400, paidAmount: 0, balanceDue: 2400, status: 'unpaid',
  party: { name: 'Ravi', phone: '', gstin: '', stateCode: '27', billingAddress: 'Line 1\nLine 2', shippingAddress: '' },
  placeOfSupply: '27', supplyType: 'intra', pricesIncludeTax: false, lines: [line], charges: [],
  subtotal: 2000, discountTotal: 0, taxableTotal: 2000, chargesTotal: 0, cgst: 180, sgst: 180, igst: 0, cess: 0, roundOff: 40,
  received: null, notes: '', terms: '', createdAt: '', updatedAt: ''
}

describe('invoiceHtml', () => {
  it('renders a tax invoice with escaped text, tax split and amount in words', () => {
    const html = invoiceHtml({ type: 'SALE_INVOICE', invoice, business, bank: null, paper: 'A4', gstRegistered: true })
    expect(html).toContain('TAX INVOICE')
    expect(html).toContain('Shop &amp; Co')
    expect(html).toContain('Pen &lt;blue&gt;')
    expect(html).not.toContain('<blue>')
    expect(html).toContain('Line 1<br>Line 2')
    expect(html).toContain('CGST')
    expect(html).not.toContain('IGST')
    expect(html).toContain('Twenty Four Rupees Only')
    expect(html).toContain('10-07-2025')
  })

  it('drops tax columns for an unregistered business and narrows for thermal paper', () => {
    const html = invoiceHtml({ type: 'SALE_INVOICE', invoice, business, bank: null, paper: 'thermal80', gstRegistered: false })
    expect(html).toContain('>INVOICE<')
    expect(html).not.toContain('CGST')
    expect(html).toContain('size: 80mm auto')
  })
})
