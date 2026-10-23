import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { Layout } from './components/Layout'
import { AgencyHome } from './pages/AgencyHome'
import { ClientHome } from './pages/ClientHome'
import { SignInPage } from './pages/SignInPage'
import { TicketPage } from './pages/TicketPage'

function AppRoutes() {
  const { user, ready } = useAuth()

  if (!ready) return null
  if (!user) return <SignInPage />

  return (
    <Routes>
      <Route path="/" element={user.role === 'agency' ? <AgencyHome /> : <ClientHome />} />
      <Route path="/tickets/:id" element={<TicketPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <AppRoutes />
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
