import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type BillingApi } from '@shared/ipc'

// The renderer gets only these calls; it never touches the database directly.
const api = Object.fromEntries(
  API_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(name, ...args)])
) as unknown as BillingApi

contextBridge.exposeInMainWorld('api', api)
