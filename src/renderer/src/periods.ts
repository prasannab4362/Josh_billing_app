// Date ranges used by the list screens' period filters.
import { fyFor, fyRange, todayLocal } from '@shared/fy'

export type PeriodKey = 'month' | 'lastMonth' | 'fy' | 'all'

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'fy', label: 'This financial year' },
  { key: 'all', label: 'All time' }
]

export function periodRange(period: PeriodKey, fyStartMonth: number, today = todayLocal()): { from?: string; to?: string } {
  const [y, m] = today.split('-').map(Number)
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10)
  if (period === 'month') return { from: iso(y, m, 1), to: iso(y, m + 1, 0) }
  if (period === 'lastMonth') return { from: iso(y, m - 1, 1), to: iso(y, m, 0) }
  if (period === 'fy') return fyRange(fyFor(today, fyStartMonth), fyStartMonth)
  return {}
}
