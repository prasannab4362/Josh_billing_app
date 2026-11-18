import type { BillingApi } from '@shared/ipc'
import { webApi } from './web/client'

/** The desktop app's bridge, or the website's server when the app runs in a browser. */
export const api: BillingApi = webApi ?? window.api

/** Turn an IPC rejection into the message the user should see. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}
