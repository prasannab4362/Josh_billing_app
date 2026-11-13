import { useEffect, useState } from 'react'
import type { AccountInput, AccountWithBalance, Business, Statement } from '@shared/models'
import { formatINR, toPaise } from '@shared/money'
import { todayLocal } from '@shared/fy'
import { api, errorMessage } from '../../api'
import { Icon, PageTitle } from '../../components/Icon'
import { Banner, DateInput, Field, Modal, TextInput, Toggle } from '../../components/Field'
import { StatementTable } from '../../components/StatementTable'
import { paiseText } from '../../forms'
import { PERIODS, periodRange, type PeriodKey } from '../../periods'

const KIND_LABEL = { cash: 'Cash', bank: 'Bank account', upi_wallet: 'UPI / wallet' } as const

export function CashBankPage({ business }: { business: Business }) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([])
  const [selectedId, setSelectedId] = useState<string>('cash')
  const [period, setPeriod] = useState<PeriodKey>('fy')
  const [statement, setStatement] = useState<Statement | null>(null)
  const [editing, setEditing] = useState<AccountWithBalance | 'new' | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = () =>
    api.listAccountsWithBalance().then((list) => {
      setAccounts(list)
      setSelectedId((id) => (list.some((a) => a.id === id) ? id : (list[0]?.id ?? 'cash')))
    }, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  const loadStatement = () =>
    api.accountStatement(selectedId, periodRange(period, business.fyStartMonth)).then(setStatement, () => setStatement(null))

  useEffect(() => {
    load()
  }, [])
  useEffect(() => {
    loadStatement()
  }, [selectedId, period, accounts])

  const selected = accounts.find((a) => a.id === selectedId)
  const cash = accounts.filter((a) => a.kind === 'cash').reduce((s, a) => s + a.balance, 0)
  const bank = accounts.filter((a) => a.kind !== 'cash').reduce((s, a) => s + a.balance, 0)

  const removeTransfer = async (id: string) => {
    if (!window.confirm('Delete this transfer?')) return
    try {
      await api.deleteTransfer(id)
      setMessage({ kind: 'success', text: 'Transfer deleted' })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const removeAccount = async (a: AccountWithBalance) => {
    if (!window.confirm(`Remove ${a.name}? Its past transactions stay in reports.`)) return
    try {
      await api.deactivateAccount(a.id)
      setMessage({ kind: 'success', text: `${a.name} removed` })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <div>
      <div className="page-head">
        <PageTitle icon="bank" tone="violet" title="Cash & bank" sub="Balances, transfers and every movement" />
        <span className="spacer" />
        <button className="btn" onClick={() => setTransferring(true)} disabled={accounts.length < 2}><Icon name="swap" size={17} />Transfer money</button>
        <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={17} />Add bank account</button>
      </div>
      <div className="stats">
        <div className="stat"><div className="label">Cash in hand</div><div className="value">{formatINR(cash)}</div></div>
        <div className="stat"><div className="label">In bank & wallets</div><div className="value">{formatINR(bank)}</div></div>
        <div className="stat"><div className="label">Total</div><div className="value">{formatINR(cash + bank)}</div></div>
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <div className="split">
        <div className="list-panel">
          <div className="list-rows">
            {accounts.map((a) => (
              <button key={a.id} className={a.id === selectedId ? 'list-row selected' : 'list-row'} onClick={() => setSelectedId(a.id)}>
                <span className="grow">
                  <span>{a.name}{a.isDefaultForPrint && <span className="badge">on invoices</span>}</span>
                  <span className="sub">{KIND_LABEL[a.kind]}{a.accountNo && ` · ${a.accountNo}`}{a.upiId && ` · ${a.upiId}`}</span>
                </span>
                <span className={a.balance < 0 ? 'amount pay' : 'amount'}>{formatINR(a.balance)}</span>
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div className="detail">
            <div className="detail-head">
              <div>
                <h2>{selected.name}</h2>
                <span className="muted">
                  {KIND_LABEL[selected.kind]}
                  {selected.bankName && ` · ${selected.bankName}`}
                  {selected.ifsc && ` · IFSC ${selected.ifsc}`}
                </span>
              </div>
              <span className="spacer" />
              <select className="input" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <button className="btn small" onClick={() => setEditing(selected)}><Icon name="edit" size={16} />Edit</button>
              {selected.kind !== 'cash' && <button className="btn small" onClick={() => removeAccount(selected)}>Remove</button>}
            </div>
            {statement && (
              <StatementTable
                statement={statement}
                debitLabel="Money in"
                creditLabel="Money out"
                action={(r) =>
                  r.kind === 'transfer' ? (
                    <button className="chip-x" title="Delete transfer" onClick={() => removeTransfer(r.sourceId)}>×</button>
                  ) : null
                }
              />
            )}
          </div>
        )}
      </div>

      {editing && (
        <AccountForm
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setEditing(null)
            setSelectedId(a.id)
            setMessage({ kind: 'success', text: `${a.name} saved` })
            load()
          }}
        />
      )}
      {transferring && (
        <TransferForm
          accounts={accounts}
          fromId={selectedId}
          onClose={() => setTransferring(false)}
          onSaved={() => {
            setTransferring(false)
            setMessage({ kind: 'success', text: 'Transfer saved' })
            load()
          }}
        />
      )}
    </div>
  )
}

function AccountForm({ account, onClose, onSaved }: { account: AccountWithBalance | null; onClose: () => void; onSaved: (a: AccountWithBalance) => void }) {
  const [f, setF] = useState({
    kind: account?.kind ?? ('bank' as AccountInput['kind']),
    name: account?.name ?? '',
    bankName: account?.bankName ?? '',
    accountNo: account?.accountNo ?? '',
    ifsc: account?.ifsc ?? '',
    upiId: account?.upiId ?? '',
    opening: paiseText(account?.openingBalance ?? null),
    openingDate: account?.openingDate || todayLocal(),
    isDefaultForPrint: account?.isDefaultForPrint ?? !account
  })
  const [failure, setFailure] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const isCash = f.kind === 'cash'

  const save = async () => {
    setFailure(null)
    let openingBalance: number
    try {
      openingBalance = f.opening.trim() ? toPaise(f.opening) : 0
    } catch {
      return setFailure('Enter the opening balance as a number')
    }
    const input: AccountInput = { ...f, openingBalance }
    try {
      onSaved(account ? await api.updateAccount(account.id, input) : await api.createAccount(input))
    } catch (e) {
      setFailure(errorMessage(e))
    }
  }

  return (
    <Modal
      title={account ? `Edit ${account.name}` : 'Add bank account'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}
    >
      {failure && <Banner kind="error">{failure}</Banner>}
      <div className="form-grid">
        {!isCash && (
          <Field label="Type" group>
            <div className="seg">
              <button type="button" className={f.kind === 'bank' ? 'on' : ''} onClick={() => set('kind', 'bank')}>Bank</button>
              <button type="button" className={f.kind === 'upi_wallet' ? 'on' : ''} onClick={() => set('kind', 'upi_wallet')}>UPI / wallet</button>
            </div>
          </Field>
        )}
        <Field label="Account name" required>
          <TextInput value={f.name} onChange={(v) => set('name', v)} autoFocus placeholder="e.g. SBI Current" />
        </Field>
        {f.kind === 'bank' && (
          <>
            <Field label="Bank name"><TextInput value={f.bankName} onChange={(v) => set('bankName', v)} /></Field>
            <Field label="Account number"><TextInput value={f.accountNo} onChange={(v) => set('accountNo', v)} inputMode="numeric" /></Field>
            <Field label="IFSC"><TextInput value={f.ifsc} onChange={(v) => set('ifsc', v.toUpperCase())} maxLength={11} /></Field>
          </>
        )}
        {!isCash && <Field label="UPI ID"><TextInput value={f.upiId} onChange={(v) => set('upiId', v)} placeholder="name@bank" /></Field>}
        <Field label="Opening balance (₹)"><TextInput value={f.opening} onChange={(v) => set('opening', v)} inputMode="decimal" placeholder="0" /></Field>
        <Field label="As of date"><DateInput value={f.openingDate} onChange={(v) => set('openingDate', v)} /></Field>
      </div>
      {!isCash && <Toggle checked={f.isDefaultForPrint} onChange={(v) => set('isDefaultForPrint', v)} label="Print these details on invoices" />}
    </Modal>
  )
}

function TransferForm({ accounts, fromId, onClose, onSaved }: { accounts: AccountWithBalance[]; fromId: string; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState(fromId)
  const [to, setTo] = useState(accounts.find((a) => a.id !== fromId)?.id ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const save = async () => {
    setFailure(null)
    try {
      await api.createTransfer({ fromAccountId: from, toAccountId: to, amount: toPaise(amount || '0'), date, notes })
      onSaved()
    } catch (e) {
      setFailure(e instanceof RangeError ? 'Enter the amount as a number' : errorMessage(e))
    }
  }

  return (
    <Modal
      title="Transfer money"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save transfer</button></>}
    >
      {failure && <Banner kind="error">{failure}</Banner>}
      <p className="muted">For example, cash deposited in the bank, or money withdrawn from an ATM.</p>
      <div className="form-grid">
        <Field label="From">
          <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatINR(a.balance)})</option>)}
          </select>
        </Field>
        <Field label="To">
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Amount (₹)"><TextInput value={amount} onChange={setAmount} inputMode="decimal" autoFocus /></Field>
        <Field label="Date"><DateInput value={date} onChange={setDate} /></Field>
        <Field label="Notes"><TextInput value={notes} onChange={setNotes} placeholder="e.g. Deposit" /></Field>
      </div>
    </Modal>
  )
}
