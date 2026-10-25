import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { initials } from '../people'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const AGENCY_NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Requests', icon: 'inbox', end: true },
  { to: '/board', label: 'Live board', icon: 'board' },
  { to: '/sites', label: 'Sites', icon: 'globe' },
  { to: '/metrics', label: 'Metrics', icon: 'chart' },
]

const CLIENT_NAV: typeof AGENCY_NAV = [{ to: '/', label: 'My requests', icon: 'inbox', end: true }]

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" />
      <path d="M16 6.5 25.5 16 16 25.5 6.5 16Z" className="brand-mark-outer" />
      <path d="M16 11.5 20.5 16 16 20.5 11.5 16Z" className="brand-mark-inner" />
    </svg>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  function handleSignOut() {
    signOut()
    // Start the next user on their home page, not on a page that belonged to the previous one.
    void navigate('/', { replace: true })
  }

  if (!user) return <main className="page">{children}</main>

  const nav = user.role === 'agency' ? AGENCY_NAV : CLIENT_NAV
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <BrandMark />
          <span>Site Change Agents</span>
        </Link>
        <nav className="side-nav" aria-label="Main">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar avatar-person avatar-sm">{initials(user.name)}</span>
          <span className="sidebar-user-text">
            <strong>{user.name}</strong>
            <small>{user.role === 'agency' ? 'Agency' : user.clientName}</small>
          </span>
          <button type="button" className="icon-button" onClick={handleSignOut} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>
      <main id="main" className="page">
        {children}
      </main>
    </div>
  )
}
