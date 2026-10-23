import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
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
        <Link to="/" className="brand">
          Site Change Agents
        </Link>
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
