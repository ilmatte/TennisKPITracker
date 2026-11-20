import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { resetLocalDatabaseOnce } from './db/database'

const rootElement = document.getElementById('root')!;

void resetLocalDatabaseOnce().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch(cause => {
  console.error('Unable to initialize the local database:', cause);
  rootElement.textContent = cause instanceof Error
    ? cause.message
    : 'Impossibile inizializzare il database locale.';
});
