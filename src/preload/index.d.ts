import type { BillingApi } from '../shared/ipc'

declare global {
  interface Window {
    api: BillingApi
  }
}

export {}
