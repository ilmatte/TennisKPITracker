import TennisApp from './TennisApp'
import AuthProvider from './features/auth/AuthProvider'
import { useAuth } from './features/auth/AuthContext'
import { FamilyProvider } from './features/families/FamilyContext'
import { BrowserRouter } from 'react-router-dom'

function App() {
  return <AuthProvider><BrowserRouter><AuthenticatedApp /></BrowserRouter></AuthProvider>
}

function AuthenticatedApp() {
  const { user } = useAuth()
  return <FamilyProvider key={user?.id ?? 'offline'}><TennisApp /></FamilyProvider>
}

export default App
