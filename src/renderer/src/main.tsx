import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isWeb } from './web/client'
import { WebGate } from './web/WebGate'
import { applySavedTheme } from './theme'
import './styles.css'

applySavedTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isWeb ? (
      <WebGate>
        <App />
      </WebGate>
    ) : (
      <App />
    )}
  </StrictMode>
)
