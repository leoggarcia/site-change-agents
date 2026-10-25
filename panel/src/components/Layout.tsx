import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { useAuth } from '../auth'

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  function handleSignOut() {
    signOut()
    // Start the next user on their home page, not on a page that belonged to the previous one.
    void navigate('/', { replace: true })
  }

  return (
    <>
      <header className="topbar">
        <nav className="nav">
          <Link to="/" className="brand">
            Site Change Agents
          </Link>
          {user?.role === 'agency' && (
            <>
              <NavLink to="/" end>
                Requests
              </NavLink>
              <NavLink to="/sites">Sites</NavLink>
              <NavLink to="/metrics">Metrics</NavLink>
            </>
          )}
        </nav>
        {user && (
          <div className="whoami">
            <span>
              {user.name}
              <small>{user.role === 'agency' ? 'Agency' : user.clientName}</small>
            </span>
            <button type="button" className="link-button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="page">{children}</main>
    </>
  )
}
