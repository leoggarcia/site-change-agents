import { api } from '../api'
import { useAuth } from '../auth'
import { useLoad } from '../useLoad'

export function SignInPage() {
  const { signIn } = useAuth()
  const { data: users, error, loading } = useLoad(api.demoUsers)

  return (
    <section className="narrow">
      <h1>Sign in</h1>
      <p className="muted">
        Demo sign-in for development: pick who you want to be. Clients see their own website; the agency sees every
        request.
      </p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      <ul className="user-list">
        {users?.map((user) => (
          <li key={user.id}>
            <button type="button" className="card user-card" onClick={() => signIn(user)}>
              <strong>{user.name}</strong>
              <span className="muted">{user.role === 'agency' ? 'Agency staff' : `Client · ${user.clientName}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
