// Validation shared by forms (to show errors) and services (to refuse bad data).

import { gstinProblem, gstinStateCode, normalizeGstin } from './gstin'
import type { BankAccountInput, BusinessProfile, ItemInput, NumberSeriesUpdate, PartyInput, TaxRateInput } from './models'
import { isStateCode } from './states'

export type Errors<T> = Partial<Record<keyof T, string>>

const PHONE = /^[6-9]\d{9}$/
const PINCODE = /^[1-9]\d{5}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/
const UPI = /^[\w.-]{2,}@[a-zA-Z]{2,}$/

export function cleanPhone(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '')
}

export function validateBusiness(p: BusinessProfile): Errors<BusinessProfile> {
  const e: Errors<BusinessProfile> = {}
  if (!p.name.trim()) e.name = 'Business name is required'
  if (!isStateCode(p.stateCode)) e.stateCode = 'Select a state'
  if (p.gstin.trim()) {
    const g = gstinError(p.gstin, p.stateCode)
    if (g) e.gstin = g
  }
  if (p.pan.trim() && !PAN.test(p.pan.trim().toUpperCase())) e.pan = 'PAN should look like ABCDE1234F'
  if (p.phone.trim() && !PHONE.test(cleanPhone(p.phone))) e.phone = 'Enter a 10-digit mobile number'
  if (p.email.trim() && !EMAIL.test(p.email.trim())) e.email = 'Enter a valid email'
  if (p.pincode.trim() && !PINCODE.test(p.pincode.trim())) e.pincode = 'Pincode should be 6 digits'
  if (!Number.isInteger(p.fyStartMonth) || p.fyStartMonth < 1 || p.fyStartMonth > 12) {
    e.fyStartMonth = 'Choose a month'
  }
  return e
}

/** Trim and normalise a profile before saving. */
export function normalizeBusiness(p: BusinessProfile): BusinessProfile {
  const gstin = normalizeGstin(p.gstin)
  return {
    ...p,
    name: p.name.trim(),
    legalName: p.legalName.trim(),
    gstin,
    pan: (p.pan.trim() || (gstin ? gstin.slice(2, 12) : '')).toUpperCase(),
    address: p.address.trim(),
    city: p.city.trim(),
    pincode: p.pincode.trim(),
    phone: p.phone.trim() ? cleanPhone(p.phone) : '',
    email: p.email.trim(),
    businessType: p.businessType.trim(),
    category: p.category.trim()
  }
}

export function validateBankAccount(b: BankAccountInput): Errors<BankAccountInput> {
  const e: Errors<BankAccountInput> = {}
  if (!b.name.trim()) e.name = 'Give this account a name'
  if (b.kind === 'bank') {
    if (b.accountNo.trim() && !/^\d{6,18}$/.test(b.accountNo.trim())) e.accountNo = 'Account number should be 6–18 digits'
    if (b.ifsc.trim() && !IFSC.test(b.ifsc.trim().toUpperCase())) e.ifsc = 'IFSC should look like SBIN0001234'
  }
  if (b.upiId.trim() && !UPI.test(b.upiId.trim())) e.upiId = 'UPI ID should look like name@bank'
  if (!Number.isInteger(b.openingBalance)) e.openingBalance = 'Invalid amount'
  return e
}

export function validateSeries(s: NumberSeriesUpdate): Errors<NumberSeriesUpdate> {
  const e: Errors<NumberSeriesUpdate> = {}
  if (s.prefix.length > 20) e.prefix = 'Prefix can be at most 20 characters'
  if (/[^\w/\-.]/.test(s.prefix)) e.prefix = 'Use letters, digits, / - . or _ only'
  if (!Number.isInteger(s.nextNumber) || s.nextNumber < 1) e.nextNumber = 'Must be 1 or more'
  if (!Number.isInteger(s.padding) || s.padding < 0 || s.padding > 8) e.padding = 'Between 0 and 8'
  return e
}

export function validateTaxRate(t: TaxRateInput): Errors<TaxRateInput> {
  const e: Errors<TaxRateInput> = {}
  if (!t.name.trim()) e.name = 'Name is required'
  if (!Number.isInteger(t.rateBp) || t.rateBp < 0 || t.rateBp > 10_000) e.rateBp = 'Rate must be 0–100%'
  if (t.kind !== 'gst' && t.rateBp !== 0) e.rateBp = 'Only GST rates can have a percentage'
  if (!Number.isInteger(t.cessBp) || t.cessBp < 0 || t.cessBp > 10_000) e.cessBp = 'Cess must be 0–100%'
  return e
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const HSN = /^\d{4}(\d{2}){0,2}$/ // 4, 6 or 8 digits
const MAX_MONEY = 1_000_000_000_00 // ₹100 crore in paise

const isMoney = (n: number, allowNegative = false) =>
  Number.isInteger(n) && Math.abs(n) <= MAX_MONEY && (allowNegative || n >= 0)

function gstinError(gstin: string, stateCode: string): string | undefined {
  const problem = gstinProblem(gstin)
  if (problem === 'format') return 'GSTIN should be 15 characters, like 27ABCDE1234F1Z5'
  if (problem === 'state') return 'GSTIN starts with an unknown state code'
  if (problem === 'checksum') return 'GSTIN check digit does not match — please re-check'
  if (isStateCode(stateCode) && gstinStateCode(gstin) !== stateCode) return 'GSTIN state does not match the selected state'
  return undefined
}

export function validateParty(p: PartyInput): Errors<PartyInput> {
  const e: Errors<PartyInput> = {}
  if (!p.name.trim()) e.name = 'Party name is required'
  else if (p.name.trim().length > 120) e.name = 'Name is too long'
  if (!['customer', 'supplier', 'both'].includes(p.kind)) e.kind = 'Choose customer or supplier'
  if (p.phone.trim() && !PHONE.test(cleanPhone(p.phone))) e.phone = 'Enter a 10-digit mobile number'
  if (p.email.trim() && !EMAIL.test(p.email.trim())) e.email = 'Enter a valid email'
  if (p.stateCode && !isStateCode(p.stateCode)) e.stateCode = 'Select a state'
  if (p.gstin.trim()) {
    const g = gstinError(p.gstin, p.stateCode)
    if (g) e.gstin = g
  }
  if (!isMoney(p.openingBalance, true)) e.openingBalance = 'Enter a valid amount'
  if (p.openingBalance !== 0 && !DATE.test(p.openingDate)) e.openingDate = 'Choose the date of this balance'
  if (p.creditLimit !== null && (!isMoney(p.creditLimit) || p.creditLimit === 0)) e.creditLimit = 'Credit limit must be more than 0'
  if (p.paymentTermDays !== null && (!Number.isInteger(p.paymentTermDays) || p.paymentTermDays < 0 || p.paymentTermDays > 365)) {
    e.paymentTermDays = 'Between 0 and 365 days'
  }
  if (p.group.trim().length > 60) e.group = 'Group name is too long'
  return e
}

export function normalizeParty(p: PartyInput): PartyInput {
  const gstin = normalizeGstin(p.gstin)
  return {
    ...p,
    name: p.name.trim(),
    phone: p.phone.trim() ? cleanPhone(p.phone) : '',
    email: p.email.trim(),
    gstin,
    // A GSTIN fixes the state; fill it in when left blank.
    stateCode: p.stateCode || (gstin && isStateCode(gstin.slice(0, 2)) ? gstin.slice(0, 2) : ''),
    billingAddress: p.billingAddress.trim(),
    shippingAddress: p.shippingAddress.trim(),
    openingDate: p.openingBalance === 0 ? '' : p.openingDate,
    group: p.group.trim()
  }
}

export function validateItem(i: ItemInput): Errors<ItemInput> {
  const e: Errors<ItemInput> = {}
  if (!i.name.trim()) e.name = 'Item name is required'
  else if (i.name.trim().length > 150) e.name = 'Name is too long'
  if (i.code.trim().length > 40) e.code = 'Code is too long'
  const barcode = (i.barcode ?? '').trim()
  if (barcode && !/^[\x20-\x7E]{1,40}$/.test(barcode)) e.barcode = 'Barcode can use English letters, digits and symbols, up to 40'
  if ((i.description ?? '').length > 500) e.description = 'Description is too long'
  if (i.kind !== 'goods' && i.kind !== 'service') e.kind = 'Choose product or service'
  if (i.hsnSac.trim() && !HSN.test(i.hsnSac.trim())) e.hsnSac = 'HSN/SAC should be 4, 6 or 8 digits'
  if (!isMoney(i.salePrice)) e.salePrice = 'Enter a valid price'
  if (!isMoney(i.purchasePrice)) e.purchasePrice = 'Enter a valid price'
  if (i.mrp !== null && !isMoney(i.mrp)) e.mrp = 'Enter a valid MRP'
  if (i.wholesalePrice !== null && !isMoney(i.wholesalePrice)) e.wholesalePrice = 'Enter a valid price'
  if (i.wholesalePrice !== null && (i.wholesaleMinQty === null || i.wholesaleMinQty <= 0)) {
    e.wholesaleMinQty = 'Minimum quantity for the wholesale price'
  }
  if (i.altUnitId) {
    if (!i.baseUnitId) e.baseUnitId = 'Choose the main unit first'
    else if (i.altUnitId === i.baseUnitId) e.altUnitId = 'Second unit must differ from the main unit'
    if (i.altConversion === null || !Number.isInteger(i.altConversion) || i.altConversion <= 0) {
      e.altConversion = 'How many main units make one of this unit'
    }
  }
  const stocked = i.kind === 'goods' && i.trackStock
  if (stocked) {
    if (!Number.isInteger(i.openingQty) || i.openingQty < 0) e.openingQty = 'Opening stock cannot be negative'
    if (!isMoney(i.openingRate)) e.openingRate = 'Enter a valid rate'
    if (i.openingQty > 0 && !DATE.test(i.openingDate)) e.openingDate = 'Choose the date of this stock'
    if (i.lowStockQty !== null && (!Number.isInteger(i.lowStockQty) || i.lowStockQty < 0)) e.lowStockQty = 'Cannot be negative'
  }
  return e
}

export function normalizeItem(i: ItemInput): ItemInput {
  const stocked = i.kind === 'goods' && i.trackStock
  return {
    ...i,
    name: i.name.trim(),
    code: i.code.trim(),
    barcode: (i.barcode ?? '').trim(),
    description: (i.description ?? '').trim(),
    category: i.category.trim(),
    hsnSac: i.hsnSac.trim(),
    altUnitId: i.altUnitId || null,
    altConversion: i.altUnitId ? i.altConversion : null,
    wholesaleMinQty: i.wholesalePrice === null ? null : i.wholesaleMinQty,
    trackStock: stocked,
    openingQty: stocked ? i.openingQty : 0,
    openingRate: stocked ? i.openingRate : 0,
    openingDate: stocked && i.openingQty > 0 ? i.openingDate : '',
    lowStockQty: stocked ? i.lowStockQty : null
  }
}

export function hasErrors(e: object): boolean {
  return Object.keys(e).length > 0
}
