import { useEffect, useRef, useState } from 'react'
import type { Business, BusinessSummary } from '@shared/models'
import { api, errorMessage } from '../api'
import { Icon, type IconName } from '../components/Icon'
import { getTheme, setTheme, type Theme } from '../theme'
import { Dashboard, type Go, type Page } from './Dashboard'
import { ReportsPage, type ReportKey } from './reports/ReportsPage'
import { ItemsPage } from './items/ItemsPage'
import { PartiesPage } from './parties/PartiesPage'
import { BillsPage } from './sales/SalesPage'
import { ExpensesPage } from './expenses/ExpensesPage'
import { PaymentsPage } from './payments/PaymentsPage'
import { CashBankPage } from './cashbank/CashBankPage'
import { SettingsPage } from './settings/SettingsPage'
import { GrowPage } from './grow/GrowPage'

interface NavEntry {
  page: Page
  icon: IconName
  /** Shown on the sidebar next to the name. */
  kbd?: string
}

const NAV: { group: string; items: NavEntry[] }[] = [
  { group: 'Overview', items: [{ page: 'Dashboard', icon: 'home' }] },
  {
    group: 'Transactions',
    items: [
      { page: 'Sale', icon: 'receipt', kbd: 'Alt S' },
      { page: 'Purchase', icon: 'cart', kbd: 'Alt P' },
      { page: 'Payments', icon: 'wallet', kbd: 'Alt I' },
      { page: 'Expenses', icon: 'cash', kbd: 'Alt E' }
    ]
  },
  {
    group: 'Records',
    items: [
      { page: 'Parties', icon: 'users' },
      { page: 'Items', icon: 'box' },
      { page: 'Cash & Bank', icon: 'bank' }
    ]
  },
  {
    group: 'Business',
    items: [
      { page: 'Reports', icon: 'chart' },
      { page: 'Grow', icon: 'sparkles' },
      { page: 'Settings', icon: 'sliders' }
    ]
  }
]

/** What each page is called in the top bar, with a short line under it. */
const TITLES: Record<Page, [string, string]> = {
  Dashboard: ['Dashboard', 'How the business is doing today'],
  Sale: ['Sale', 'Invoices, estimates, orders, challans and returns'],
  Purchase: ['Purchase', 'Bills from suppliers, purchase orders and returns'],
  Payments: ['Payments', 'Money received from customers and paid to suppliers'],
  Expenses: ['Expenses', 'Rent, salary, bills and other running costs'],
  Parties: ['Parties', 'Customers and suppliers'],
  Items: ['Items', 'Products, services and stock'],
  'Cash & Bank': ['Cash & bank', 'Balances, transfers and account history'],
  Reports: ['Reports', 'Registers, statements, profit and GST returns'],
  Grow: ['Grow', 'Posters, catalogue and WhatsApp'],
  Settings: ['Settings', 'Business details, printing and data']
}

const COLLAPSE_KEY = 'shell.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

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
  const [newOpen, setNewOpen] = useState(false)
  const [others, setOthers] = useState<BusinessSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const menuRef = useRef<HTMLDivElement>(null)
  const newRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    api.listBusinesses().then((list) => setOthers(list.filter((b) => b.id !== business.id)))
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen, business.id])

  useEffect(() => {
    if (!newOpen) return
    const close = (e: MouseEvent) => {
      if (!newRef.current?.contains(e.target as Node)) setNewOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [newOpen])

  // Keyboard shortcuts for the everyday entries.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const key = e.key.toLowerCase()
      if (key === 's') go('Sale', { new: true, type: 'SALE_INVOICE' })
      else if (key === 'p') go('Purchase', { new: true, type: 'PURCHASE_BILL' })
      else if (key === 'i') go('Payments', { new: true, direction: 'in' })
      else if (key === 'e') go('Expenses', { new: true })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // Not remembered; the sidebar still toggles.
      }
      return !c
    })
  }

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

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

  const startNew = (...args: Parameters<Go>) => {
    setNewOpen(false)
    go(...args)
  }

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const [title, sub] = TITLES[page]
  const place = [business.city, business.gstin ? `GSTIN ${business.gstin}` : ''].filter(Boolean).join(' · ')

  return (
    <div className={collapsed ? 'shell collapsed' : 'shell'}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">J</span>
          <span className="brand-text">
            <b>Josh Billing</b>
            <small>GST · STOCK · ACCOUNTS</small>
          </span>
        </div>
        {NAV.map((g) => (
          <div key={g.group} style={{ display: 'contents' }}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((n) => (
              <button
                key={n.page}
                className={n.page === page ? 'nav active' : 'nav'}
                title={collapsed ? n.page : undefined}
                onClick={() => setPage(n.page)}
              >
                <Icon name={n.icon} size={19} />
                <span className="nav-label">{n.page}</span>
                {n.kbd && <span className="nav-kbd">{n.kbd}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <div className="side-card" title={business.name}>
            <span className="avatar small">{business.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <b>{business.name}</b>
              <small>{place || 'Works offline · data on this computer'}</small>
            </div>
          </div>
          <button className="nav" onClick={toggleCollapsed} title={collapsed ? 'Expand the sidebar' : undefined}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={19} />
            <span className="nav-label">Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={toggleCollapsed} title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}>
            <Icon name="sidebar" />
          </button>
          <div className="topbar-title">
            <b>{title}</b>
            <small>{sub}</small>
          </div>
          <span className="spacer" />
          {error && <span className="field-error">{error}</span>}
          <span className="today-chip">
            <Icon name="calendar" size={15} />
            {today}
          </span>
          <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light look' : 'Switch to dark look'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <div className="switcher" ref={newRef}>
            <button className="btn primary" onClick={() => setNewOpen((o) => !o)}>
              <Icon name="plus" size={17} /> Create <Icon name="chevronDown" size={15} />
            </button>
            {newOpen && (
              <div className="menu right">
                <div className="menu-label">Sale</div>
                <button className="menu-item" onClick={() => startNew('Sale', { new: true, type: 'SALE_INVOICE' })}>
                  <Icon name="receipt" /> Sale invoice <span className="kbd">Alt S</span>
                </button>
                <button className="menu-item" onClick={() => startNew('Sale', { new: true, type: 'ESTIMATE' })}>
                  <Icon name="file" /> Estimate / quotation
                </button>
                <button className="menu-item" onClick={() => startNew('Payments', { new: true, direction: 'in' })}>
                  <Icon name="arrowIn" /> Payment received <span className="kbd">Alt I</span>
                </button>
                <div className="menu-label">Purchase</div>
                <button className="menu-item" onClick={() => startNew('Purchase', { new: true, type: 'PURCHASE_BILL' })}>
                  <Icon name="cart" /> Purchase bill <span className="kbd">Alt P</span>
                </button>
                <button className="menu-item" onClick={() => startNew('Payments', { new: true, direction: 'out' })}>
                  <Icon name="arrowOut" /> Payment made
                </button>
                <button className="menu-item" onClick={() => startNew('Expenses', { new: true })}>
                  <Icon name="cash" /> Expense <span className="kbd">Alt E</span>
                </button>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => startNew('Parties', { new: true })}>
                  <Icon name="users" /> Party
                </button>
                <button className="menu-item" onClick={() => startNew('Items', { new: true })}>
                  <Icon name="box" /> Item
                </button>
              </div>
            )}
          </div>
          <div className="switcher" ref={menuRef}>
            <button className="switcher-btn" onClick={() => setMenuOpen((o) => !o)} title="Switch business">
              <span className="avatar small grad">{business.name.slice(0, 1).toUpperCase()}</span>
              <span className="who">
                <strong>{business.name}</strong>
                <small>{business.gstin ? 'GST registered' : 'Business'}</small>
              </span>
              <Icon name="chevronDown" size={16} className="muted" />
            </button>
            {menuOpen && (
              <div className="menu right">
                {others.length > 0 && <div className="menu-label">Switch to</div>}
                {others.map((b) => (
                  <button key={b.id} className="menu-item" onClick={() => switchTo(b.id)}>
                    <span className="avatar small">{b.name.slice(0, 1).toUpperCase()}</span> {b.name}
                  </button>
                ))}
                {others.length > 0 && <div className="menu-sep" />}
                <button className="menu-item" onClick={() => { setMenuOpen(false); setPage('Settings') }}>
                  <Icon name="building" /> Business details
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); onCreateNew() }}>
                  <Icon name="plus" /> New business
                </button>
                <div className="menu-sep" />
                <button className="menu-item danger" onClick={closeBusiness}>
                  <Icon name="logout" /> Close business
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content">
          {page === 'Dashboard' && <Dashboard key={k('dash')} business={business} go={go} />}
          {page === 'Parties' && <PartiesPage key={k('parties')} openId={target.open?.id ?? null} startNew={!!target.open?.new} />}
          {page === 'Items' && <ItemsPage key={k('items')} startNew={!!target.open?.new} />}
          {page === 'Sale' && <BillsPage key={k('sale')} business={business} side="sale" open={target.open} />}
          {page === 'Purchase' && <BillsPage key={k('purchase')} business={business} side="purchase" open={target.open} />}
          {page === 'Expenses' && <ExpensesPage key={k('expenses')} business={business} startNew={!!target.open?.new} />}
          {page === 'Payments' && (
            <PaymentsPage key={k('payments')} business={business} startNew={target.open?.new ? target.open.direction ?? 'in' : undefined} />
          )}
          {page === 'Cash & Bank' && <CashBankPage key={k('cash')} business={business} />}
          {page === 'Reports' && <ReportsPage key={k('reports')} business={business} initial={target.open?.id as ReportKey | undefined} go={go} />}
          {page === 'Grow' && <GrowPage key={k('grow')} business={business} />}
          {page === 'Settings' && <SettingsPage business={business} onBusinessChange={onBusinessChange} />}
        </main>
      </div>
    </div>
  )
}
