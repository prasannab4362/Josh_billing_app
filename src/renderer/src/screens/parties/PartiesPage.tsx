import { useEffect, useMemo, useState } from 'react'
import type { Party, PartyKind, PaymentDirection, Statement } from '@shared/models'
import { formatINR } from '@shared/money'
import { stateName } from '@shared/states'
import { api, errorMessage } from '../../api'
import { Icon, PageTitle } from '../../components/Icon'
import { Banner } from '../../components/Field'
import { StatementTable } from '../../components/StatementTable'
import { PaymentForm } from '../payments/PaymentForm'
import { PartyForm } from './PartyForm'
import { ImportModal } from '../../components/ImportModal'
import { WhatsAppModal } from '../../components/WhatsAppModal'
import { reminderMessage } from '@shared/share'
import type { Business, MoneyAccount } from '@shared/models'

type Filter = 'all' | 'customer' | 'supplier' | 'receive' | 'pay'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'customer', label: 'Customers' },
  { key: 'supplier', label: 'Suppliers' },
  { key: 'receive', label: 'To receive' },
  { key: 'pay', label: 'To pay' }
]

const KIND_LABEL: Record<PartyKind, string> = { customer: 'Customer', supplier: 'Supplier', both: 'Customer & supplier' }

function matches(p: Party, filter: Filter, search: string): boolean {
  if (filter === 'customer' && p.kind === 'supplier') return false
  if (filter === 'supplier' && p.kind === 'customer') return false
  if (filter === 'receive' && p.balance <= 0) return false
  if (filter === 'pay' && p.balance >= 0) return false
  if (!search) return true
  const q = search.toLowerCase()
  return p.name.toLowerCase().includes(q) || p.phone.includes(q) || p.gstin.toLowerCase().includes(q)
}

export function BalanceText({ paise }: { paise: number }) {
  if (paise === 0) return <span className="amount muted">{formatINR(0)}</span>
  return (
    <span className={paise > 0 ? 'amount receive' : 'amount pay'} title={paise > 0 ? 'To receive' : 'To pay'}>
      {formatINR(Math.abs(paise))}
    </span>
  )
}

export function PartiesPage({ openId = null, startNew = false }: { openId?: string | null; startNew?: boolean }) {
  const [parties, setParties] = useState<Party[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(openId)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Party | 'new' | null>(startNew ? 'new' : null)
  const [importing, setImporting] = useState(false)
  const [reminding, setReminding] = useState<{ party: Party; business: Business; bank: MoneyAccount | null } | null>(null)
  const [paying, setPaying] = useState<{ direction: PaymentDirection; partyId: string } | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const remind = async (p: Party) => {
    try {
      const [business, accounts] = await Promise.all([api.currentBusiness(), api.listAccounts()])
      if (!business) return
      const bank = accounts.find((a) => a.kind !== 'cash' && a.isDefaultForPrint) ?? accounts.find((a) => a.kind !== 'cash') ?? null
      setReminding({ party: p, business, bank })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  const exportExcel = async () => {
    try {
      const path = await api.exportToExcel('parties')
      if (path) setMessage({ kind: 'success', text: `Saved ${path}` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  const load = () =>
    api.listParties().then(
      (list) => {
        setParties(list)
        setSelectedId((id) => (id && list.some((p) => p.id === id) ? id : (list[0]?.id ?? null)))
      },
      (e) => setMessage({ kind: 'error', text: errorMessage(e) })
    )
  useEffect(() => {
    load()
  }, [])

  const shown = useMemo(() => parties.filter((p) => matches(p, filter, search.trim())), [parties, filter, search])
  const selected = parties.find((p) => p.id === selectedId) ?? null
  const toReceive = parties.reduce((s, p) => s + Math.max(p.balance, 0), 0)
  const toPay = parties.reduce((s, p) => s + Math.max(-p.balance, 0), 0)

  const saved = (p: Party) => {
    setEditing(null)
    setSelectedId(p.id)
    setMessage({ kind: 'success', text: `${p.name} saved` })
    load()
  }

  const toggleActive = async (p: Party) => {
    try {
      await api.setPartyActive(p.id, !p.isActive)
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const remove = async (p: Party) => {
    if (!window.confirm(`Delete ${p.name}? Its opening balance will be removed too.`)) return
    try {
      await api.deleteParty(p.id)
      setMessage({ kind: 'success', text: `${p.name} deleted` })
      setSelectedId(null)
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <div>
      <div className="page-head">
        <PageTitle icon="users" tone="teal" title="Parties" sub="Customers and suppliers, with what they owe" />
        <span className="spacer" />
        <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" size={17} />Import from Excel</button>
        <button className="btn" onClick={exportExcel}><Icon name="download" size={17} />Export to Excel</button>
        <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={17} />Add party</button>
      </div>
      <div className="stats">
        <div className="stat">
          <div className="label">You'll receive</div>
          <div className="value receive">{formatINR(toReceive)}</div>
        </div>
        <div className="stat">
          <div className="label">You'll pay</div>
          <div className="value pay">{formatINR(toPay)}</div>
        </div>
        <div className="stat">
          <div className="label">Parties</div>
          <div className="value">{parties.length}</div>
        </div>
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <div className="split">
        <div className="list-panel">
          <div className="list-tools">
            <div className="search-wrap">
          <Icon name="search" size={16} />
          <input className="input" placeholder="Search name, phone or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
            <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {FILTERS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="list-rows">
            {shown.length === 0 && (
              <div className="empty">{parties.length ? 'No parties match' : 'No parties yet. Add your first customer or supplier.'}</div>
            )}
            {shown.map((p) => (
              <button
                key={p.id}
                className={['list-row', p.id === selectedId ? 'selected' : '', p.isActive ? '' : 'inactive'].join(' ')}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="grow">
                  <span>{p.name}{!p.isActive && <span className="badge">inactive</span>}</span>
                  <span className="sub">{p.phone || KIND_LABEL[p.kind]}</span>
                </span>
                <BalanceText paise={p.balance} />
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <div className="detail">
            <div className="detail-head">
              <div>
                <h2>{selected.name}</h2>
                <span className="muted">{KIND_LABEL[selected.kind]}{selected.group && ` · ${selected.group}`}</span>
              </div>
              <span className="spacer" />
              {selected.kind !== 'supplier' && (
                <button className="btn small primary" onClick={() => setPaying({ direction: 'in', partyId: selected.id })}><Icon name="arrowIn" size={15} />Receive payment</button>
              )}
              {selected.kind !== 'customer' && (
                <button className="btn small primary" onClick={() => setPaying({ direction: 'out', partyId: selected.id })}><Icon name="arrowOut" size={15} />Make payment</button>
              )}
              <button className="btn small" onClick={() => remind(selected)}><Icon name="chat" size={15} />{selected.balance > 0 ? 'WhatsApp reminder' : 'WhatsApp'}</button>
              <button className="btn small" onClick={() => setEditing(selected)}><Icon name="edit" size={16} />Edit</button>
              <button className="btn small" onClick={() => toggleActive(selected)}>
                {selected.isActive ? 'Mark inactive' : 'Mark active'}
              </button>
              {!selected.hasTransactions && (
                <button className="btn small" onClick={() => remove(selected)}>Delete</button>
              )}
            </div>
            <dl className="facts">
              <div>
                <dt>Balance</dt>
                <dd>
                  <BalanceText paise={selected.balance} />{' '}
                  <span className="muted">{selected.balance > 0 ? 'to receive' : selected.balance < 0 ? 'to pay' : ''}</span>
                </dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{selected.phone || '—'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{selected.email || '—'}</dd>
              </div>
              <div>
                <dt>GSTIN</dt>
                <dd className="mono">{selected.gstin || 'Unregistered'}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{selected.stateCode ? stateName(selected.stateCode) : '—'}</dd>
              </div>
              <div>
                <dt>Payment terms</dt>
                <dd>{selected.paymentTermDays !== null ? `${selected.paymentTermDays} days` : 'Default'}</dd>
              </div>
              <div>
                <dt>Billing address</dt>
                <dd>{selected.billingAddress || '—'}</dd>
              </div>
              <div>
                <dt>Shipping address</dt>
                <dd>{selected.shippingAddress || (selected.billingAddress ? 'Same as billing' : '—')}</dd>
              </div>
              <div>
                <dt>Credit limit</dt>
                <dd>{selected.creditLimit !== null ? formatINR(selected.creditLimit) : 'None'}</dd>
              </div>
            </dl>
            <PartyStatement partyId={selected.id} version={selected.updatedAt + selected.balance} />
          </div>
        ) : (
          <div className="detail empty">Select a party to see its details.</div>
        )}
      </div>

      {paying && (
        <PaymentForm
          direction={paying.direction}
          paymentId={null}
          partyId={paying.partyId}
          onClose={() => setPaying(null)}
          onSaved={(p) => {
            setPaying(null)
            if (p) setMessage({ kind: 'success', text: `Payment ${p.number} saved` })
            load()
          }}
        />
      )}
      {reminding && (
        <WhatsAppModal
          title={`WhatsApp ${reminding.party.name}`}
          phone={reminding.party.phone}
          initial={reminding.party.balance > 0 ? reminderMessage(reminding.party, reminding.business, reminding.bank) : `Hello ${reminding.party.name},\n\n\n${reminding.business.name}`}
          onClose={() => setReminding(null)}
          onSend={async (text) => {
            await api.openWhatsApp(reminding.party.phone, text)
            return 'WhatsApp opened with the message.'
          }}
        />
      )}
      {importing && <ImportModal kind="parties" onClose={() => setImporting(false)} onImported={load} />}
      {editing && (
        <PartyForm party={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </div>
  )
}

function PartyStatement({ partyId, version }: { partyId: string; version: string }) {
  const [statement, setStatement] = useState<Statement | null>(null)
  useEffect(() => {
    api.partyStatement(partyId, {}).then(setStatement, () => setStatement(null))
  }, [partyId, version])
  if (!statement) return null
  return (
    <>
      <h3>Statement</h3>
      <StatementTable
        statement={statement}
        debitLabel="Billed"
        creditLabel="Paid"
        balance={(p) => (
          <>
            <BalanceText paise={p} /> <span className="muted small-note">{p > 0 ? 'Dr' : p < 0 ? 'Cr' : ''}</span>
          </>
        )}
      />
    </>
  )
}
