// The website's sign-in: nothing of the app shows until the person has signed in with email and password.
// Also the account menu in the top bar (team, password, sign out) and the team window for owners.
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { passwordProblem, ROLES } from '@shared/auth'
import { emailProblem, type TeamMember, type WebMe } from '@shared/web'
import { api, errorMessage } from '../api'
import { Banner, Field, Modal } from '../components/Field'
import { Icon } from '../components/Icon'
import { addStaff, getMe, listTeam, onSignedOut, removeStaff, signIn, signOut, signUp } from './client'

interface Account {
  me: WebMe
  /** Ask the server again (after opening another business, the role may differ). */
  refresh: () => void
}

const AccountContext = createContext<Account | null>(null)
export const useAccount = () => useContext(AccountContext)

export function WebGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<WebMe | null>(null)
  const [error, setError] = useState('')

  const load = () => getMe().then(setMe, (e) => setError(errorMessage(e)))
  useEffect(() => {
    load()
    return onSignedOut(() => setMe((m) => (m ? { ...m, user: null, role: null, businessId: null } : m)))
  }, [])

  if (error) return <div className="center-page"><Banner kind="error">{error}</Banner></div>
  if (!me) return <div className="center-page muted">Loading…</div>
  if (!me.user) return <SignInPage signupOpen={me.signupOpen} onDone={() => location.reload()} />
  return <AccountContext.Provider value={{ me, refresh: load }}>{children}</AccountContext.Provider>
}

function SignInPage({ signupOpen, onDone }: { signupOpen: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const errs: Record<string, string> = {}
    if (mode === 'up' && !name.trim()) errs.name = 'Enter your name'
    const em = emailProblem(email)
    if (em) errs.email = em
    if (mode === 'up') {
      const p = passwordProblem(password, email.split('@')[0] ?? '')
      if (p) errs.password = p
    } else if (!password) errs.password = 'Enter your password'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      if (mode === 'up') await signUp(name, email, password)
      else await signIn(email, password)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="center-page">
      <form className="welcome auth-card" onSubmit={submit} noValidate>
        <div className="welcome-mark"><span className="brand-mark">J</span></div>
        <h1>{mode === 'in' ? 'Sign in to Josh Books' : 'Create your account'}</h1>
        <p className="muted">GST billing, stock and accounts for your shop, from any browser.</p>
        {error && <Banner kind="error">{error}</Banner>}
        {mode === 'up' && (
          <Field label="Your name" error={errors.name}>
            <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
        )}
        <Field label="Email" error={errors.email}>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoFocus />
        </Field>
        <Field label="Password" error={errors.password} hint={mode === 'up' ? 'At least 8 characters' : undefined}>
          <input
            className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={password}
            onChange={(e) => setPassword(e.target.value)} maxLength={128}
          />
        </Field>
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        {signupOpen && (
          <p className="muted small auth-switch">
            {mode === 'in' ? 'New here? ' : 'Have an account? '}
            <button type="button" className="link-btn" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErrors({}); setError('') }}>
              {mode === 'in' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        )}
        {mode === 'in' && <p className="muted small">Forgot your password? Ask your shop owner or the website's administrator to reset it.</p>}
      </form>
    </div>
  )
}

/** The account button in the top bar: who is signed in, the team (owner), password and sign out. */
export function AccountMenu() {
  const account = useAccount()
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<'team' | 'password' | null>(null)
  if (!account?.me.user) return null
  const { user, role } = account.me
  return (
    <div className="switcher">
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} title={`Signed in as ${user.email}`} aria-label="Account">
        <Icon name="user" />
      </button>
      {open && (
        <div className="menu right" onMouseLeave={() => setOpen(false)}>
          <div className="menu-note muted small"><b>{user.name}</b>{user.email}{role ? ` · ${ROLES[role]}` : ''}</div>
          <div className="menu-sep" />
          {role === 'owner' && (
            <button className="menu-item" onClick={() => { setOpen(false); setModal('team') }}>
              <Icon name="users" /> Team (staff logins)
            </button>
          )}
          <button className="menu-item" onClick={() => { setOpen(false); setModal('password') }}>
            <Icon name="shield" /> Change password
          </button>
          <button className="menu-item danger" onClick={() => signOut().finally(() => location.reload())}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
      )}
      {modal === 'team' && <TeamModal onClose={() => setModal(null)} />}
      {modal === 'password' && <PasswordModal onClose={() => setModal(null)} />}
    </div>
  )
}

function TeamModal({ onClose }: { onClose: () => void }) {
  const [team, setTeam] = useState<TeamMember[] | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const reload = () => listTeam().then(setTeam, (e) => setError(errorMessage(e)))
  useEffect(() => {
    reload()
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setDone('')
    try {
      const m = await addStaff(form)
      setDone(`${m.name} (${m.email}) can now sign in and bill for this business.`)
      setForm({ name: '', email: '', password: '' })
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const remove = async (m: TeamMember) => {
    if (!window.confirm(`Take away ${m.name}'s access to this business?`)) return
    try {
      await removeStaff(m.userId)
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal title="Team" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Staff sign in with their own email and password. They can make sale bills, take payments, and add parties and items,
        but cannot see purchases, expenses, cash and bank, reports or business settings, or change bills from earlier days.
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      {done && <Banner kind="success">{done}</Banner>}
      <table className="table compact">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
        <tbody>
          {(team ?? []).map((m) => (
            <tr key={m.userId}>
              <td>{m.name}</td>
              <td>{m.email}</td>
              <td>{ROLES[m.role]}</td>
              <td>{m.role === 'staff' && <button className="btn small" onClick={() => remove(m)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={add} className="team-add">
        <h3>Add a staff member</h3>
        <div className="form-grid">
          <Field label="Name"><input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Password for them" hint="Only for a new email; tell it to them in person">
            <input className="input" type="password" autoComplete="new-password" value={form.password} maxLength={128} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
        <button className="btn primary" type="submit">Add to team</button>
      </form>
    </Modal>
  )
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.changeMyPassword(current, next)
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <Modal title="Change password" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error && <Banner kind="error">{error}</Banner>}
      {done ? (
        <Banner kind="success">Password changed. You were signed out on every other device.</Banner>
      ) : (
        <form onSubmit={save}>
          <Field label="Current password">
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <input className="input" type="password" autoComplete="new-password" value={next} maxLength={128} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <button className="btn primary" type="submit">Change password</button>
        </form>
      )}
    </Modal>
  )
}
