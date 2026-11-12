import type { Statement, StatementRow } from '@shared/models'
import { formatINR } from '@shared/money'

interface Props {
  statement: Statement
  /** Column names for debit / credit, e.g. "Billed" / "Paid" for a party, "In" / "Out" for an account. */
  debitLabel: string
  creditLabel: string
  /** How to show the running balance (parties show to receive / to pay). */
  balance?: (paise: number) => React.ReactNode
  action?: (row: StatementRow) => React.ReactNode
}

export function StatementTable({ statement, debitLabel, creditLabel, balance = (p) => formatINR(p), action }: Props) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Details</th>
          <th>No.</th>
          <th className="amount">{debitLabel}</th>
          <th className="amount">{creditLabel}</th>
          <th className="amount">Balance</th>
          {action && <th />}
        </tr>
      </thead>
      <tbody>
        {statement.openingBalance !== 0 && (
          <tr className="muted">
            <td />
            <td>Balance brought forward</td>
            <td />
            <td />
            <td />
            <td className="amount">{balance(statement.openingBalance)}</td>
            {action && <td />}
          </tr>
        )}
        {statement.rows.length === 0 && (
          <tr>
            <td colSpan={action ? 7 : 6} className="muted">No transactions yet.</td>
          </tr>
        )}
        {statement.rows.map((r, i) => (
          <tr key={`${r.sourceId}-${i}`}>
            <td className="nowrap">{r.date}</td>
            <td>{r.label}</td>
            <td>{r.number}</td>
            <td className="amount">{r.debit ? formatINR(r.debit) : ''}</td>
            <td className="amount">{r.credit ? formatINR(r.credit) : ''}</td>
            <td className="amount">{balance(r.balance)}</td>
            {action && <td>{action(r)}</td>}
          </tr>
        ))}
      </tbody>
      {statement.rows.length > 0 && (
        <tfoot>
          <tr>
            <td />
            <td><strong>Total</strong></td>
            <td />
            <td className="amount"><strong>{formatINR(statement.totalDebit)}</strong></td>
            <td className="amount"><strong>{formatINR(statement.totalCredit)}</strong></td>
            <td className="amount"><strong>{balance(statement.closingBalance)}</strong></td>
            {action && <td />}
          </tr>
        </tfoot>
      )}
    </table>
  )
}
