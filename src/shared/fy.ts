// Financial year helpers. Dates are 'YYYY-MM-DD' strings in local time.

/** '2025-26' for any date from the start month of 2025 up to the month before it in 2026. */
export function fyFor(date: string, startMonth = 4): string {
  const [y, m] = date.split('-').map(Number)
  const startYear = m >= startMonth ? y : y - 1
  if (startMonth === 1) return String(startYear)
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** Short label used in invoice prefixes: '2025-26' -> '25-26'. */
export function fyShort(fy: string): string {
  const [a, b] = fy.split('-')
  return b ? `${a.slice(2)}-${b}` : a.slice(2)
}

export function fyRange(fy: string, startMonth = 4): { from: string; to: string } {
  const startYear = Number(fy.slice(0, 4))
  const mm = String(startMonth).padStart(2, '0')
  const from = `${startYear}-${mm}-01`
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 0))
  return { from, to: end.toISOString().slice(0, 10) }
}

export function todayLocal(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
