import { useEffect, useRef, useState } from 'react'
import type { Business, BusinessSummary } from '@shared/models'
import { api, errorMessage } from '../api'
import { Dashboard, type Go } from './Dashboard'
import { ReportsPage, type ReportKey } from './reports/ReportsPage'
import { ItemsPage } from './items/ItemsPage'
import { PartiesPage } from './parties/PartiesPage'
import { BillsPage } from './sales/SalesPage'
import { ExpensesPage } from './expenses/ExpensesPage'
import { PaymentsPage } from './payments/PaymentsPage'
import { CashBankPage } from './cashbank/CashBankPage'
import { SettingsPage } from './settings/SettingsPage'

const NAV = ['Dashboard', 'Parties', 'Items', 'Sale', 'Payments', 'Purchase', 'Cash & Bank', 'Expenses', 'Reports', 'Settings'] as const
type Page = (typeof NAV)[number]
const READY: Page[] = ['Dashboard', 'Parties', 'Items', 'Sale', 'Payments', 'Purchase', 'Cash & Bank', 'Expenses', 'Reports', 'Settings']

interface Props {
  business: Business
  onBusinessChange: (b: Business) => void
  onSwitch: (b: Business) => void
  onCreateNew: () => void
  onClosed: () => void
}

export function Shell({ business, onBusinessChange, onSwitch, onCreateNew, onClosed }: Props) {
  const [page, setPageRaw] = useState<Page>('Dashboard')
  // What to open on arrival, and a counter so arriving again remounts the page.
  const [target, setTarget] = useState<{ open?: Parameters<Go>[1]; n: number }>({ n: 0 })
  const setPage = (p: Page) => {
    setPageRaw(p)
    setTarget((t) => ({ n: t.n + 1 }))
  }
  const go: Go = (p, open) => {
    setPageRaw(p)
    setTarget((t) => ({ open, n: t.n + 1 }))
  }
  const k = (name: string) => `${name}-${business.id}-${target.n}`
  const [menuOpen, setMenuOpen] = useState(false)
  const [others, setOthers] = useState<BusinessSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    api.listBusinesses().then((list) => setOthers(list.filter((b) => b.id !== business.id)))
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen, business.id])

  const switchTo = async (id: string) => {
    setMenuOpen(false)
    try {
      onSwitch(await api.openBusiness(id))
      setPage('Dashboard')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const closeBusiness = async () => {
    setMenuOpen(false)
    await api.closeBusiness()
    onClosed()
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Billing App</div>
        {NAV.map((n) => (
          <button
            key={n}
            className={n === page ? 'nav active' : 'nav'}
            disabled={!READY.includes(n)}
            title={READY.includes(n) ? undefined : 'Coming in a later phase'}
            onClick={() => setPage(n)}
          >
            {n}
          </button>
        ))}
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="switcher" ref={menuRef}>
            <button className="switcher-btn" onClick={() => setMenuOpen((o) => !o)}>
              <span className="avatar small">{business.name.slice(0, 1).toUpperCase()}</span>
              <strong>{business.name}</strong> <span className="muted">▾</span>
            </button>
            {menuOpen && (
              <div className="menu">
                {others.length > 0 && <div className="menu-label">Switch to</div>}
                {others.map((b) => (
                  <button key={b.id} className="menu-item" onClick={() => switchTo(b.id)}>
                    {b.name}
                  </button>
                ))}
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { setMenuOpen(false); onCreateNew() }}>
                  + New business
                </button>
                <button className="menu-item" onClick={closeBusiness}>
                  Close business
                </button>
              </div>
            )}
          </div>
          {error && <span className="field-error">{error}</span>}
        </header>
        <main className="content">
          {page === 'Dashboard' && <Dashboard key={k('dash')} business={business} go={go} />}
          {page === 'Parties' && <PartiesPage key={k('parties')} openId={target.open?.id ?? null} />}
          {page === 'Items' && <ItemsPage key={k('items')} />}
          {page === 'Sale' && <BillsPage key={k('sale')} business={business} side="sale" open={target.open} />}
          {page === 'Purchase' && <BillsPage key={k('purchase')} business={business} side="purchase" open={target.open} />}
          {page === 'Expenses' && <ExpensesPage key={k('expenses')} business={business} />}
          {page === 'Payments' && <PaymentsPage key={k('payments')} business={business} />}
          {page === 'Cash & Bank' && <CashBankPage key={k('cash')} business={business} />}
          {page === 'Reports' && <ReportsPage key={k('reports')} business={business} initial={target.open?.id as ReportKey | undefined} go={go} />}
          {page === 'Settings' && <SettingsPage business={business} onBusinessChange={onBusinessChange} />}
        </main>
      </div>
    </div>
  )
}
