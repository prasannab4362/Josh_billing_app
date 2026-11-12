import { describe, expect, it } from 'vitest'
import { completeFeatures } from './features'
import type { Invoice, MoneyAccount } from './models'
import { POSTER_SIZES, POSTER_TEMPLATES, posterFileName, posterHtml, type PosterData } from './posters'
import { billMessage, catalogueHtml, DEFAULT_CATALOGUE, googleProfileFields, reminderMessage, whatsappLink, whatsappNumber } from './share'

const data: PosterData = { businessName: 'Kumar <& Sons>', logo: '', phone: '9000012345', contact: 'Ravi', address: 'Main Road', headline: 'Happy Diwali', subline: 'Joy', offer: 'Flat 10% off' }
const bank: MoneyAccount = { id: 'b', kind: 'bank', name: 'SBI', bankName: 'SBI', accountNo: '123', ifsc: 'SBIN0001', upiId: 'shop@sbi', isDefaultForPrint: true }

describe('posters', () => {
  it('draw every template at the exact image size, with the details escaped', () => {
    expect(new Set(POSTER_TEMPLATES.map((t) => t.id)).size).toBe(POSTER_TEMPLATES.length)
    for (const t of POSTER_TEMPLATES) {
      for (const size of ['square', 'story'] as const) {
        const h = posterHtml(t, data, size)
        expect(h).toContain(`width: ${POSTER_SIZES[size].width}px; height: ${POSTER_SIZES[size].height}px`)
        expect(h).toContain('Kumar &lt;&amp; Sons&gt;')
        expect(h).toContain('<div class="offer">Flat 10% off</div>')
        expect(h).not.toContain('<script')
      }
      expect(t.headline.ta !== undefined && t.subline.hi !== undefined).toBe(true)
    }
  })

  it('show a product with its price, MRP and saving', () => {
    const tpl = POSTER_TEMPLATES.find((t) => t.id === 'product')!
    const h = posterHtml(tpl, { ...data, itemName: 'Linen Shirt', price: 89_900, mrp: 99_900 }, 'square')
    expect(h).toContain('<div class="pname">Linen Shirt</div>')
    expect(h).toContain('₹899')
    expect(h).toContain('<s>MRP ₹999</s>')
    expect(h).toContain('Save 10%')
    expect(posterFileName(tpl, { ...data, itemName: 'A/B' })).toBe('Kumar <& Sons> A B'.replace(/[<>]/g, ' ').replace(/\s+/g, ' '))
  })

  it('put a QR code on the review poster', () => {
    const tpl = POSTER_TEMPLATES.find((t) => t.id === 'review-us')!
    expect(posterHtml(tpl, { ...data, qr: 'https://g.page/r/abc/review' }, 'square')).toMatch(/<div class="qr"><svg[^>]+viewBox/)
    expect(posterHtml(tpl, data, 'square')).not.toContain('class="qr"')
    expect(completeFeatures({ reviewLink: ' https://g.page/r/abc ' }).reviewLink).toBe('https://g.page/r/abc')
    expect(completeFeatures({ reviewLink: 'javascript:alert(1)' }).reviewLink).toBe('')
  })
})

describe('catalogue', () => {
  it('groups items by category and shows price, MRP and % off', () => {
    const h = catalogueHtml([
      { name: 'Shirt', description: 'Cotton', category: 'Clothing', price: 45_000, mrp: 50_000, unit: 'pcs', photo: null },
      { name: 'Rice', description: '', category: '', price: 62_000, mrp: null, unit: 'kg', photo: 'data:image/png;base64,AA' }
    ], DEFAULT_CATALOGUE, { name: 'Shop', phone: '9000012345', address: 'Main Road', city: 'Madurai', logo: '', gstin: '' })
    expect(h).toContain('<h2>Clothing</h2>')
    expect(h).toContain('<h2>Other items</h2>')
    expect(h).toContain('<b>₹450.00</b><small>/pcs</small> <s>₹500.00</s>')
    expect(h).toContain('<div class="off">10% off</div>')
    expect(h).toContain('<img src="data:image/png;base64,AA"')
    expect(h).toContain('grid-template-columns: repeat(3, 1fr)')
    const plain = catalogueHtml([{ name: 'Shirt', description: '', category: 'Clothing', price: 45_000, mrp: 50_000, unit: '', photo: null }], { ...DEFAULT_CATALOGUE, showPrice: false, byCategory: false }, { name: 'Shop', phone: '', address: '', city: '', logo: '', gstin: '' })
    expect(plain).not.toContain('₹450.00')
    expect(plain).not.toContain('<h2>')
  })
})

describe('WhatsApp', () => {
  it('turns Indian mobile numbers into wa.me numbers', () => {
    expect(whatsappNumber('98765 43210')).toBe('919876543210')
    expect(whatsappNumber('+91-98765-43210')).toBe('919876543210')
    expect(whatsappNumber('09876543210')).toBe('919876543210')
    expect(whatsappNumber('0452 2345678')).toBe('') // landline
    expect(whatsappLink('9876543210', 'Hi & bye\nok')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye%0Aok')
    expect(whatsappLink('', 'Hi')).toBe('https://wa.me/?text=Hi')
  })

  it('write the bill message with balance, due date and UPI ID', () => {
    const inv = { number: 'INV-7', date: '2026-11-12', dueDate: '2026-11-27', grandTotal: 233_400, paidAmount: 50_000, balanceDue: 183_400, party: { name: 'Lakshmi Stores' } } as unknown as Invoice
    const m = billMessage('SALE_INVOICE', inv, { name: 'Shop', phone: '9000012345' }, bank)
    expect(m).toContain('Dear Lakshmi Stores,')
    expect(m).toContain('Invoice INV-7 dated 12-11-2026: ₹2,334.00.')
    expect(m).toContain('Received: ₹500.00.')
    expect(m).toContain('Balance due: ₹1,834.00 by 27-11-2026.')
    expect(m).toContain('Pay by UPI to shop@sbi.')
    const est = billMessage('ESTIMATE', { ...inv, paidAmount: 0 } as Invoice, { name: 'Shop', phone: '' }, bank)
    expect(est).toContain('Estimate INV-7')
    expect(est).not.toContain('Balance due')
  })

  it('write a payment reminder', () => {
    const m = reminderMessage({ name: 'Ravi', balance: 150_000 }, { name: 'Shop', phone: '' }, bank)
    expect(m).toContain('₹1,500.00 is due to Shop')
    expect(m).toContain('UPI to shop@sbi')
    expect(m).toContain('A/c 123')
  })

  it('lays out details for a Google Business Profile', () => {
    const f = googleProfileFields({ name: 'Shop', phone: '9000012345', address: '1 Main Rd', city: 'Madurai', pincode: '625001', email: '', gstin: '' } as never)
    expect(f.find((x) => x.label === 'Phone')?.value).toBe('+91 9000012345')
    expect(f.find((x) => x.label === 'Address')?.value).toBe('1 Main Rd, Madurai, 625001')
  })
})
