// Printing and PDF export of invoices through a hidden window.
import { writeFileSync } from 'node:fs'
import { BrowserWindow, dialog, shell } from 'electron'
import { invoiceHtml, type InvoicePrintData } from '@shared/invoiceHtml'
import { reportCsv, reportHtml, type ReportDoc } from '@shared/reportDoc'

async function withPage<T>(html: string, run: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await run(win)
  } finally {
    win.destroy()
  }
}

export async function renderPdf(data: InvoicePrintData): Promise<Buffer> {
  return withPage(invoiceHtml(data), (win) =>
    win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
  )
}

const safeName = (s: string) => s.replace(/[\/:*?"<>|]+/g, '-').trim()

/** Ask where to save a file. Returns the chosen path, or null if cancelled. */
async function askSavePath(name: string, ext: 'pdf' | 'csv'): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const filters = ext === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'CSV (opens in Excel)', extensions: ['csv'] }]
  const options = { defaultPath: `${safeName(name)}.${ext}`, filters }
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** Ask where to save, write the PDF and open it. Returns the path, or null if cancelled. */
export async function exportPdf(data: InvoicePrintData): Promise<string | null> {
  const path = await askSavePath(`${data.invoice.number || 'Bill'} ${data.invoice.party.name}`, 'pdf')
  if (!path) return null
  writeFileSync(path, await renderPdf(data))
  void shell.openPath(path)
  return path
}

/** Save a report as a PDF (opened afterwards) or a CSV file for Excel. */
export async function exportReport(doc: ReportDoc, businessName: string, format: 'pdf' | 'csv'): Promise<string | null> {
  const path = await askSavePath(`${doc.title} ${doc.subtitle}`, format)
  if (!path) return null
  if (format === 'csv') writeFileSync(path, reportCsv(doc, businessName), 'utf8')
  else {
    const pdf = await withPage(reportHtml(doc, businessName), (win) =>
      win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
    )
    writeFileSync(path, pdf)
  }
  void shell.openPath(path)
  return path
}

function printHtml(html: string): Promise<boolean> {
  return withPage(
    html,
    (win) =>
      new Promise<boolean>((resolve, reject) => {
        win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => {
          if (ok || reason === 'cancelled' || reason === 'Print job canceled') resolve(ok)
          else reject(new Error(reason))
        })
      })
  )
}

/** Open the system print dialog for the invoice. Resolves false if the user cancelled. */
export const printInvoice = (data: InvoicePrintData) => printHtml(invoiceHtml(data))
export const printReport = (doc: ReportDoc, businessName: string) => printHtml(reportHtml(doc, businessName))

export const printLabels = (html: string) => printHtml(html)

/** Save barcode labels as a PDF and open it (for printing on another computer or a print shop). */
export async function saveLabelsPdf(html: string): Promise<string | null> {
  const path = await askSavePath('Barcode labels', 'pdf')
  if (!path) return null
  const pdf = await withPage(html, (win) => win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }))
  writeFileSync(path, pdf)
  void shell.openPath(path)
  return path
}
