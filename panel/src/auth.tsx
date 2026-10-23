import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getStoredUserId, setCurrentUserId } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  ready: boolean
  signIn: (user: User) => void
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // With no stored user there is nothing to restore, so the app is ready right away.
  const [ready, setReady] = useState(() => !getStoredUserId())

  useEffect(() => {
    if (ready) return
    api
      .me()
      .then(setUser)
      .catch(() => setCurrentUserId(null))
      .finally(() => setReady(true))
    // Runs once on load to restore the stored session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = useCallback((next: User) => {
    setCurrentUserId(next.id)
    setUser(next)
  }, [])

  const signOut = useCallback(() => {
    setCurrentUserId(null)
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, ready, signIn, signOut }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>')
  return state
}
