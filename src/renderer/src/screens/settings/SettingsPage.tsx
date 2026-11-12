import { useState } from 'react'
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

interface Props {
  business: Business
  onBusinessChange: (b: Business) => void
}

export function SettingsPage({ business, onBusinessChange }: Props) {
  const [tab, setTab] = useState<Tab>('Business')
  return (
    <div>
      <h1>Settings</h1>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
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
  )
}
