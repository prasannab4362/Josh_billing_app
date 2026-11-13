import { useEffect, useMemo, useState } from 'react'
import { BILL_INFO, payDirection, PURCHASE_TYPES, SALE_TYPES } from '@shared/billTypes'
import type { BillType, Business, Invoice, InvoiceStatus, InvoiceSummary, PaperSize } from '@shared/models'
import { formatINR } from '@shared/money'
import { invoiceHtml } from '@shared/invoiceHtml'
import { api, errorMessage } from '../../api'
import { Banner } from '../../components/Field'
import { Icon, PageTitle, type IconName } from '../../components/Icon'
import { PERIODS, periodRange, type PeriodKey } from '../../periods'
import { PaymentForm } from '../payments/PaymentForm'
import { InvoiceEditor } from './InvoiceEditor'
import { WhatsAppModal } from '../../components/WhatsAppModal'
import { billMessage } from '@shared/share'
import type { InvoicePrintData } from '@shared/invoiceHtml'

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: 'Paid', partial: 'Partly paid', unpaid: 'Unpaid', overdue: 'Overdue', open: 'Open', converted: 'Converted'
}
/** Returns are "settled" (set off or refunded) rather than paid. */
const RETURN_LABEL: Partial<Record<InvoiceStatus, string>> = { paid: 'Settled', partial: 'Part settled', unpaid: 'Open' }

export function StatusBadge({ status, type }: { status: InvoiceStatus; type?: BillType }) {
  const label = (type && BILL_INFO[type].returnOf && RETURN_LABEL[status]) || STATUS_LABEL[status]
  const cls = status
  return <span className={`status ${cls}`}>{label}</span>
}

/** Each kind of bill has its own picture on tabs and titles. */
export const BILL_ICON: Record<BillType, IconName> = {
  SALE_INVOICE: 'receipt', ESTIMATE: 'file', SALE_ORDER: 'list', DELIVERY_CHALLAN: 'box', SALE_RETURN: 'undo',
  PURCHASE_BILL: 'cart', PURCHASE_ORDER: 'list', PURCHASE_RETURN: 'undo'
}

/** Papers a bill can be printed on: a small counter bill or a full invoice sheet. */
const PAPERS: { value: PaperSize; label: string; hint: string }[] = [
  { value: 'thermal80', label: 'Bill 80 mm', hint: 'Counter receipt on an 80 mm (3 inch) thermal printer' },
  { value: 'thermal58', label: 'Bill 58 mm', hint: 'Counter receipt on a 58 mm (2 inch) thermal printer' },
  { value: 'A4', label: 'Invoice A4', hint: 'Full tax invoice on A4 paper' },
  { value: 'A5', label: 'Invoice A5', hint: 'Full tax invoice on A5 (half A4) paper' }
]

type Mode =
  | { name: 'list' }
  | { name: 'view'; id: string }
  | { name: 'edit'; id: string | null; from?: { id: string; type: BillType } }

type Message = { kind: 'error' | 'success'; text: string } | null

interface PageProps {
  business: Business
  side: 'sale' | 'purchase'
  /** Open straight on one bill, or on a new one (from the dashboard or a report). */
  open?: { id?: string; new?: boolean; type?: BillType }
}

/** Sale or Purchase: one tab per kind of document, sharing the list, view and editor. */
export function BillsPage({ business, side, open }: PageProps) {
  const types = side === 'sale' ? SALE_TYPES : PURCHASE_TYPES
  const [type, setType] = useState<BillType>(open?.type ?? types[0])
  const [mode, setMode] = useState<Mode>(
    open?.id ? { name: 'view', id: open.id } : open?.new ? { name: 'edit', id: null } : { name: 'list' }
  )
  const [message, setMessage] = useState<Message>(null)
  const info = BILL_INFO[type]

  const go = (t: BillType, m: Mode, msg: Message = null) => {
    setType(t)
    setMode(m)
    setMessage(msg)
  }

  let body
  if (mode.name === 'edit') {
    body = (
      <InvoiceEditor
        key={`${type}-${mode.id}-${mode.from?.id}`}
        type={type}
        business={business}
        invoiceId={mode.id}
        from={mode.from ?? null}
        onCancel={() => go(mode.from?.type ?? type, mode.id ? { name: 'view', id: mode.id } : mode.from ? { name: 'view', id: mode.from.id } : { name: 'list' })}
        onSaved={(inv, print) => {
          go(type, { name: 'view', id: inv.id }, { kind: 'success', text: `${info.noun} ${inv.number} saved`.replace('  ', ' ') })
          if (print) api.printBill(type, inv.id).catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))
        }}
      />
    )
  } else if (mode.name === 'view') {
    body = (
      <InvoiceView
        key={`${type}-${mode.id}`}
        type={type}
        id={mode.id}
        message={message}
        onBack={() => go(type, { name: 'list' })}
        onEdit={() => go(type, { name: 'edit', id: mode.id })}
        onNew={() => go(type, { name: 'edit', id: null })}
        onMake={(t) => go(t, { name: 'edit', id: null, from: { id: mode.id, type } })}
        onOpenLinked={(t, id) => go(t, { name: 'view', id })}
        onDeleted={(number) => go(type, { name: 'list' }, { kind: 'success', text: `${info.noun} ${number} deleted`.replace('  ', ' ') })}
      />
    )
  } else {
    body = (
      <BillList
        key={type}
        type={type}
        business={business}
        message={message}
        onOpen={(id) => go(type, { name: 'view', id })}
        onNew={() => go(type, { name: 'edit', id: null })}
      />
    )
  }

  return (
    <div>
      {mode.name !== 'edit' && (
        <nav className="tabs">
          {types.map((t) => (
            <button key={t} className={t === type ? 'tab active' : 'tab'} onClick={() => go(t, { name: 'list' })}>
              <Icon name={BILL_ICON[t]} size={16} />{BILL_INFO[t].plural.replace(/ \(.*\)$/, '')}
            </button>
          ))}
        </nav>
      )}
      {body}
    </div>
  )
}

/** Kept for callers that show one kind only. */
export function SalesPage({ business, type = 'SALE_INVOICE', open }: { business: Business; type?: BillType; open?: { id?: string; new?: boolean } }) {
  return <BillsPage business={business} side={BILL_INFO[type].side} open={{ ...open, type }} />
}

interface ListProps {
  type: BillType
  business: Business
  message: Message
  onOpen: (id: string) => void
  onNew: () => void
}

function BillList({ type, business, message, onOpen, onNew }: ListProps) {
  const info = BILL_INFO[type]
  const purchase = info.side === 'purchase'
  const [period, setPeriod] = useState<PeriodKey>('fy')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const [list, setList] = useState<InvoiceSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listBills(type, periodRange(period, business.fyStartMonth)).then(setList, (e) => setError(errorMessage(e)))
  }, [period, business.fyStartMonth, type])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter(
      (i) =>
        (!status || i.status === status || (status === 'unpaid' && i.status === 'overdue')) &&
        (!q || i.number.toLowerCase().includes(q) || i.partyName.toLowerCase().includes(q))
    )
  }, [list, search, status])
  const total = list.reduce((s, i) => s + i.grandTotal, 0)
  const paid = list.reduce((s, i) => s + i.paidAmount, 0)
  const due = list.reduce((s, i) => s + i.balanceDue, 0)
  const openCount = list.filter((i) => i.status === 'open').length
  const partyWord = purchase ? 'Supplier' : 'Party'

  return (
    <div>
      <div className="page-head">
        <PageTitle icon={BILL_ICON[type]} tone={info.side === 'sale' ? 'accent' : 'violet'} title={info.plural} sub={info.side === 'sale' ? 'Bills you give to customers' : 'Bills you get from suppliers'} />
        <span className="spacer" />
        <button className="btn primary" onClick={onNew}><Icon name="plus" size={17} />{info.newLabel.replace(/^\+ /, '')}</button>
      </div>
      <div className="stats">
        <div className="stat"><div className="label">Total</div><div className="value">{formatINR(total)}</div></div>
        {info.posts ? (
          <>
            <div className="stat"><div className="label">{info.paidWord || 'Settled'}{info.returnOf ? ' / set off' : ''}</div><div className="value receive">{formatINR(paid)}</div></div>
            <div className="stat"><div className="label">{info.returnOf ? 'Still to settle' : 'Balance due'}</div><div className="value pay">{formatINR(due)}</div></div>
          </>
        ) : (
          <>
            <div className="stat"><div className="label">Open</div><div className="value">{openCount}</div></div>
            <div className="stat"><div className="label">Converted</div><div className="value receive">{list.length - openCount}</div></div>
          </>
        )}
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" size={16} />
          <input className="input search" placeholder={`Search number or ${partyWord.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')}>
          <option value="">Any status</option>
          {info.posts ? (
            <>
              <option value="unpaid">{info.returnOf ? 'Open' : 'Unpaid'}</option>
              <option value="partial">{info.returnOf ? 'Part settled' : 'Partly paid'}</option>
              {!info.returnOf && <option value="overdue">Overdue</option>}
              <option value="paid">{info.returnOf ? 'Settled' : 'Paid'}</option>
            </>
          ) : (
            <>
              <option value="open">Open</option>
              <option value="converted">Converted</option>
            </>
          )}
        </select>
      </div>
      <div className="card wide" style={{ maxWidth: 'none', padding: 0 }}>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Number</th>
              <th>{partyWord}</th>
              <th className="amount">Total</th>
              {info.posts && <th className="amount">{info.returnOf ? 'To settle' : 'Balance'}</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  {list.length ? 'Nothing matches' : `No ${info.plural.toLowerCase().replace(/ \(.*\)$/, '')} in this period.`}
                </td>
              </tr>
            )}
            {shown.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => onOpen(i.id)}>
                <td>{i.date}</td>
                <td>{i.number || '—'}</td>
                <td>{i.partyName}</td>
                <td className="amount">{formatINR(i.grandTotal)}</td>
                {info.posts && <td className="amount">{formatINR(i.balanceDue)}</td>}
                <td><StatusBadge status={i.status} type={type} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface ViewProps {
  type: BillType
  id: string
  message: Message
  onBack: () => void
  onEdit: () => void
  onNew: () => void
  /** Start a new document of another kind from this one (convert, or return). */
  onMake: (type: BillType) => void
  onOpenLinked: (type: BillType, id: string) => void
  onDeleted: (number: string) => void
}

function InvoiceView({ type, id, message, onBack, onEdit, onNew, onMake, onOpenLinked, onDeleted }: ViewProps) {
  const info = BILL_INFO[type]
  const direction = payDirection(type)
  const [html, setHtml] = useState('')
  const [bill, setBill] = useState<Invoice | null>(null)
  const [note, setNote] = useState(message)
  const [busy, setBusy] = useState(false)
  const [paying, setPaying] = useState(false)
  const [version, setVersion] = useState(0)
  const [printData, setPrintData] = useState<InvoicePrintData | null>(null)
  const [sharing, setSharing] = useState(false)
  // Paper for this bill: null = the business's usual paper (Settings › Preferences).
  const [paper, setPaper] = useState<PaperSize | null>(null)

  useEffect(() => {
    api.getBillPrint(type, id, paper ?? undefined).then(
      (data) => {
        setPrintData(data)
        setBill(data.invoice)
        setHtml(invoiceHtml(data))
      },
      (e) => setNote({ kind: 'error', text: errorMessage(e) })
    )
  }, [id, version, paper])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    try {
      await f()
    } catch (e) {
      setNote({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const pdf = () =>
    run(async () => {
      const path = await api.exportBillPdf(type, id, paper ?? undefined)
      if (path) setNote({ kind: 'success', text: `PDF saved to ${path}` })
    })
  const print = () => run(async () => void (await api.printBill(type, id, paper ?? undefined)))
  const remove = () =>
    run(async () => {
      const effect = info.posts ? ' Stock and the party balance will be restored.' : ''
      if (!bill || !window.confirm(`Delete ${info.noun.toLowerCase()} ${bill.number}?${effect}`)) return
      await api.deleteBill(type, id)
      onDeleted(bill.number)
    })

  const payLabel =
    type === 'SALE_RETURN' ? 'Pay refund' : type === 'PURCHASE_RETURN' ? 'Receive refund' : direction === 'out' ? 'Make payment' : 'Receive payment'
  // Returns are made against invoices and bills.
  const returnType: BillType | null = type === 'SALE_INVOICE' ? 'SALE_RETURN' : type === 'PURCHASE_BILL' ? 'PURCHASE_RETURN' : null

  return (
    <div>
      <div className="page-head">
        <button className="btn" onClick={onBack}><Icon name="arrowLeft" size={17} />{info.plural.replace(/ \(.*\)$/, '')}</button>
        <h1>{bill ? `${info.noun} ${bill.number}` : info.noun}</h1>
        {bill && <StatusBadge status={bill.status} type={type} />}
        <span className="spacer" />
        {bill && info.posts && bill.balanceDue > 0 && bill.partyId && (
          <button className="btn" onClick={() => setPaying(true)} disabled={busy}><Icon name="wallet" size={17} />{payLabel}</button>
        )}
        {bill && bill.status !== 'converted' && info.convertsTo.map((t) => (
          <button key={t} className="btn" onClick={() => onMake(t)} disabled={busy}><Icon name="swap" size={17} />Convert to {BILL_INFO[t].noun.toLowerCase()}</button>
        ))}
        {bill && returnType && bill.partyId && (
          <button className="btn" onClick={() => onMake(returnType)} disabled={busy}><Icon name="undo" size={17} />{type === 'SALE_INVOICE' ? 'Sale return' : 'Purchase return'}</button>
        )}
        <button className="btn" onClick={onEdit} disabled={busy}><Icon name="edit" size={16} />Edit</button>
        <button className="btn danger" onClick={remove} disabled={busy}><Icon name="trash" size={17} />Delete</button>
        <button className="btn" onClick={pdf} disabled={busy}><Icon name="file" size={17} />PDF</button>
        {bill && <button className="btn" onClick={() => setSharing(true)} disabled={busy}><Icon name="chat" size={17} />WhatsApp</button>}
        <button className="btn" onClick={print} disabled={busy}><Icon name="printer" size={17} />Print</button>
        <button className="btn primary" onClick={onNew}><Icon name="plus" size={17} />{info.newLabel.replace(/^\+ /, '')}</button>
      </div>
      {note && <Banner kind={note.kind}>{note.text}</Banner>}
      {bill && (
        <div className="stats">
          <div className="stat"><div className="label">Total</div><div className="value">{formatINR(bill.grandTotal)}</div></div>
          {info.posts && (
            <>
              <div className="stat"><div className="label">{info.returnOf ? 'Settled' : info.paidWord}</div><div className="value receive">{formatINR(bill.paidAmount)}</div></div>
              <div className="stat"><div className="label">{info.returnOf ? 'Still to settle' : 'Balance due'}</div><div className="value pay">{formatINR(bill.balanceDue)}</div></div>
            </>
          )}
          {(type === 'SALE_INVOICE' || type === 'PURCHASE_BILL' || type === 'ESTIMATE') && (
            <div className="stat"><div className="label">{type === 'ESTIMATE' ? 'Valid till' : 'Due date'}</div><div className="value">{bill.dueDate || '—'}</div></div>
          )}
        </div>
      )}
      {bill && bill.links.length > 0 && (
        <div className="links">
          {bill.links.map((l) => (
            <button key={l.id} className="link-chip" onClick={() => onOpenLinked(l.type, l.id)}>
              {linkText(l, type)}
            </button>
          ))}
        </div>
      )}
      {sharing && bill && printData && (
        <WhatsAppModal
          title={`Send ${info.noun.toLowerCase()} on WhatsApp`}
          phone={bill.party.phone}
          initial={billMessage(type, bill, printData.business, printData.bank)}
          onClose={() => setSharing(false)}
          onSend={async (text) => {
            const path = await api.shareBillOnWhatsApp(type, id, text)
            return `WhatsApp opened. The PDF is saved at ${path} (its folder is open): drag it into the chat to attach it.`
          }}
        />
      )}
      {paying && bill?.partyId && (
        <PaymentForm
          direction={direction}
          paymentId={null}
          partyId={bill.partyId}
          documentId={bill.id}
          onClose={() => setPaying(false)}
          onSaved={(p) => {
            setPaying(false)
            if (p) setNote({ kind: 'success', text: `Payment ${p.number} saved` })
            setVersion((v) => v + 1)
          }}
        />
      )}
      {printData && (
        <div className="print-as">
          <span className="muted"><Icon name="printer" size={16} /> Print as</span>
          <div className="seg">
            {PAPERS.map((p) => (
              <button key={p.value} className={(paper ?? printData.paper) === p.value ? 'on' : ''} onClick={() => setPaper(p.value)} title={p.hint}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="muted small-text">{(paper ?? printData.paper).startsWith('thermal') ? 'Small bill for the counter printer' : 'Full GST invoice on a sheet'}</span>
        </div>
      )}
      {html && <iframe className={printData?.paper.startsWith('thermal') ? 'invoice-preview thermal' : 'invoice-preview'} title="Preview" sandbox="" srcDoc={html} />}
    </div>
  )
}

function linkText(l: Invoice['links'][number], self: BillType): string {
  const other = `${BILL_INFO[l.type].noun} ${l.number}`
  if (l.kind === 'converted') return l.direction === 'from' ? `Made from ${other}` : `Converted to ${other}`
  if (l.direction === 'from') return `Against ${other} · ${formatINR(l.amount)} set off`
  return `${other} · ${formatINR(l.amount)} set off against this ${BILL_INFO[self].noun.toLowerCase()}`
}
