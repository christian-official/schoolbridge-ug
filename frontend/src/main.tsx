import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PWAInstallPrompt from './PWAInstallPrompt'

// Capture the browser install event before React effects mount. Some browsers
// dispatch it early during page startup, before the install UI can subscribe.
declare global {
  interface Window {
    schoolBridgeInstallPrompt?: Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    window.schoolBridgeInstallPrompt = event as Window['schoolBridgeInstallPrompt']
    window.dispatchEvent(new Event('schoolbridge:install-prompt'))
  })
}

// Persist the school identity immediately when a user opens the official QR URL.
// The installed PWA starts at '/', so it must be able to recover this school context.
if (typeof window !== 'undefined') {
  const schoolFromQr = new URLSearchParams(window.location.search).get('school')
  if (schoolFromQr) {
    try { localStorage.setItem('schoolbridge-selected-school-id', schoolFromQr) }
    catch { /* QR query remains available for this browser session. */ }
  }
}

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
