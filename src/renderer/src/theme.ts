// Light or dark look, remembered on this computer. Applied as data-theme on <html>.
export type Theme = 'light' | 'dark'

const KEY = 'ui.theme'

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage blocked: fall back to the system setting.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Not remembered; the look still changes for now.
  }
}

/** Apply the remembered look before the first paint. */
export function applySavedTheme(): void {
  document.documentElement.dataset.theme = getTheme()
}
