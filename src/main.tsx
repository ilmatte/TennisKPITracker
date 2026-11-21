import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { resetLocalDatabaseOnce } from './db/database'
import { logTechnicalDiagnostic, normalizeUiError } from './services/uiMessages'

const rootElement = document.getElementById('root')!;

void resetLocalDatabaseOnce().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch(cause => {
  logTechnicalDiagnostic('local-database-startup', cause);
  rootElement.textContent = normalizeUiError('local-startup', cause);
});
