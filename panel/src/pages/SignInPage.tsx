import { api } from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { BrandMark } from '../components/Layout'
import { Skeleton } from '../components/States'
import { initials } from '../people'
import type { User } from '../types'
import { useLoad } from '../useLoad'

const STEPS = [
  'Ask for a change in your own words',
  'Agents make it, check it and show you a preview',
  'You approve, and it goes live',
]

function UserButton({ user, onPick }: { user: User; onPick: (user: User) => void }) {
  return (
    <button type="button" className="user-card" onClick={() => onPick(user)}>
      <span className={`avatar ${user.role === 'agency' ? 'avatar-agency' : 'avatar-person'}`}>{initials(user.name)}</span>
      <span className="who">
        <strong>{user.name}</strong>
        <small>{user.role === 'agency' ? 'Sees every request and the agents at work' : user.clientName}</small>
      </span>
      <span className="chevron">
        <Icon name="chevron" size={16} />
      </span>
    </button>
  )
}

export function SignInPage() {
  const { signIn } = useAuth()
  const { data: users, error, loading } = useLoad(api.demoUsers)
  const agency = users?.filter((user) => user.role === 'agency') ?? []
  const clients = users?.filter((user) => user.role === 'client') ?? []

  return (
    <div className="signin">
      <section className="signin-intro">
        <div className="brand">
          <BrandMark />
          <span>Site Change Agents</span>
        </div>
        <h1>Website changes, from request to live in minutes.</h1>
        <p className="muted">
          Clients describe a change. Agents turn it into a ticket, edit the site, check their work and open a
          preview. A person approves every change before it is published.
        </p>
        <ol className="signin-steps">
          {STEPS.map((step, index) => (
            <li key={step}>
              <span className="step-num">{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section className="card signin-panel">
        <h2>Sign in</h2>
        <p className="muted small">Demo sign-in: pick who you want to be.</p>
        {loading && <Skeleton rows={4} />}
        {error && <p className="error">{error}</p>}
        {agency.length > 0 && <p className="user-group-label">Agency</p>}
        <ul className="user-list">
          {agency.map((user) => (
            <li key={user.id}>
              <UserButton user={user} onPick={signIn} />
            </li>
          ))}
        </ul>
        {clients.length > 0 && <p className="user-group-label">Clients</p>}
        <ul className="user-list">
          {clients.map((user) => (
            <li key={user.id}>
              <UserButton user={user} onPick={signIn} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
