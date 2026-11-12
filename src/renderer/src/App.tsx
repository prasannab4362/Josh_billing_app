import { useEffect, useState } from 'react'
import type { Business, BusinessSummary } from '@shared/models'
import { api, errorMessage } from './api'
import { Banner } from './components/Field'
import { Onboarding } from './screens/Onboarding'
import { Shell } from './screens/Shell'
import { Welcome } from './screens/Welcome'

type View =
  | { name: 'loading' }
  | { name: 'welcome'; businesses: BusinessSummary[] }
  | { name: 'onboarding'; returnTo: Business | null; firstRun?: boolean }
  | { name: 'main'; business: Business }

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' })
  const [error, setError] = useState<string | null>(null)

  const showStart = async () => {
    const businesses = await api.listBusinesses()
    setView(businesses.length ? { name: 'welcome', businesses } : { name: 'onboarding', returnTo: null, firstRun: true })
  }

  useEffect(() => {
    api
      .currentBusiness()
      .then((b) => (b ? setView({ name: 'main', business: b }) : showStart()))
      .catch((e) => setError(errorMessage(e)))
  }, [])

  if (error) {
    return (
      <div className="center-page">
        <Banner kind="error">Could not start: {error}</Banner>
      </div>
    )
  }

  switch (view.name) {
    case 'loading':
      return <div className="center-page muted">Loading…</div>
    case 'welcome':
      return (
        <Welcome
          businesses={view.businesses}
          onOpened={(business) => setView({ name: 'main', business })}
          onCreate={() => setView({ name: 'onboarding', returnTo: null })}
        />
      )
    case 'onboarding': {
      const back = view.returnTo
      return (
        <Onboarding
          onDone={(business) => setView({ name: 'main', business })}
          onCancel={
            view.firstRun ? undefined : back ? () => setView({ name: 'main', business: back }) : () => void showStart()
          }
        />
      )
    }
    case 'main':
      return (
        <Shell
          key={view.business.id}
          business={view.business}
          onBusinessChange={(business) => setView({ name: 'main', business })}
          onSwitch={(business) => setView({ name: 'main', business })}
          onCreateNew={() => setView({ name: 'onboarding', returnTo: view.business })}
          onClosed={() => void showStart()}
        />
      )
  }
}
