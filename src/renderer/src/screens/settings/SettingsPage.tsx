import { useState } from 'react'
import { Icon, PageTitle, type IconName } from '../../components/Icon'
import type { Business } from '@shared/models'
import { BusinessTab } from './BusinessTab'
import { PreferencesTab } from './PreferencesTab'
import { NumberingTab } from './NumberingTab'
import { TaxRatesTab } from './TaxRatesTab'
import { UnitsTab } from './UnitsTab'
import { PrintTab } from './PrintTab'
import { ItemFieldsTab } from './ItemFieldsTab'
import { OwnFieldsSettings, TransactionsTab } from './FeaturesTab'
import { BackupTab, HistoryTab, RecycleBinTab } from './DataTabs'

const TABS = ['Business', 'Preferences', 'Transactions', 'Print', 'Extra fields', 'Invoice numbering', 'Tax rates', 'Units', 'Backup & restore', 'Recycle bin', 'Change history'] as const
type Tab = (typeof TABS)[number]

const GROUPS: [string, Tab[]][] = [
  ['Business', ['Business', 'Preferences', 'Transactions', 'Print', 'Extra fields']],
  ['Setup', ['Invoice numbering', 'Tax rates', 'Units']],
  ['Your data', ['Backup & restore', 'Recycle bin', 'Change history']]
]

const TAB_ICON: Record<Tab, IconName> = {
  Business: 'building', Preferences: 'sliders', Transactions: 'receipt', Print: 'printer', 'Extra fields': 'layers',
  'Invoice numbering': 'hash', 'Tax rates': 'percent', Units: 'ruler', 'Backup & restore': 'shield', 'Recycle bin': 'trash',
  'Change history': 'history'
}

interface Props {
  business: Business
  onBusinessChange: (b: Business) => void
}

export function SettingsPage({ business, onBusinessChange }: Props) {
  const [tab, setTab] = useState<Tab>('Business')
  return (
    <div>
      <div className="page-head">
        <PageTitle icon="sliders" tone="slate" title="Settings" sub="Business details, printing, numbering and your data" />
      </div>
      <div className="reports">
      <nav className="report-nav">
        {GROUPS.map(([group, tabs]) => (
          <div key={group}>
            <div className="menu-label">{group}</div>
            {tabs.map((t) => (
              <button key={t} className={t === tab ? 'nav active' : 'nav'} onClick={() => setTab(t)}>
                <Icon name={TAB_ICON[t]} size={17} />
                {t}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="report-body">
      <div className="card wide">
        {tab === 'Business' && <BusinessTab business={business} onSaved={onBusinessChange} />}
        {tab === 'Preferences' && <PreferencesTab />}
        {tab === 'Print' && <PrintTab />}
        {tab === 'Transactions' && <TransactionsTab />}
        {tab === 'Extra fields' && (
          <>
            <ItemFieldsTab />
            <OwnFieldsSettings />
          </>
        )}
        {tab === 'Invoice numbering' && <NumberingTab />}
        {tab === 'Tax rates' && <TaxRatesTab />}
        {tab === 'Units' && <UnitsTab />}
        {tab === 'Backup & restore' && <BackupTab business={business} onBusinessChange={onBusinessChange} />}
        {tab === 'Recycle bin' && <RecycleBinTab />}
        {tab === 'Change history' && <HistoryTab />}
      </div>
      </div>
      </div>
    </div>
  )
}
