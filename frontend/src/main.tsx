import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PWAInstallPrompt from './PWAInstallPrompt'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Offline shell support is optional; the application remains usable online.
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <App />
      <PWAInstallPrompt />
    </>
  </StrictMode>,
)
