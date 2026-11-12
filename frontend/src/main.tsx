import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PWAInstallPrompt from './PWAInstallPrompt'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then(registration => {
      const announceUpdate = () => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent('schoolbridge:pwa-update', { detail: registration.waiting }))
        }
      }
      announceUpdate()
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') announceUpdate()
        })
      })
    }).catch(() => {
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
