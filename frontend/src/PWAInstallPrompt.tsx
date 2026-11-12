import { useEffect, useRef, useState } from 'react'
import { Download, Share, WifiOff, X } from 'lucide-react'
import './PWAInstallPrompt.css'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine)
  const [isAppleMobile, setIsAppleMobile] = useState(false)
  const [showAppleSteps, setShowAppleSteps] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [applyingUpdate, setApplyingUpdate] = useState(false)
  const applyingUpdateRef = useRef(false)

  useEffect(() => {
    const updateConnection = () => setIsOffline(!navigator.onLine)
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const worker = (event as CustomEvent<ServiceWorker>).detail
      if (worker) setWaitingWorker(worker)
    }
    const handleControllerChange = () => {
      if (applyingUpdateRef.current) window.location.reload()
    }
    window.addEventListener('schoolbridge:pwa-update', handleUpdate)
    navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange)
    return () => {
      window.removeEventListener('schoolbridge:pwa-update', handleUpdate)
      navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [])

  function applyUpdate() {
    if (!waitingWorker) return
    applyingUpdateRef.current = true
    setApplyingUpdate(true)
    waitingWorker.postMessage({ type: 'SCHOOLBRIDGE_SKIP_WAITING' })
  }

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    if (standalone) return

    const appleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    setIsAppleMobile(appleMobile)

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as InstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstallEvent(null)
      setDismissed(true)
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  async function install() {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    setInstallEvent(null)
    if (choice.outcome === 'accepted') setDismissed(true)
  }

  const hideInstallCard = (dismissed && !waitingWorker) || (!installEvent && !isAppleMobile && !waitingWorker)
  if (hideInstallCard && !isOffline) return null

  return (
    <>
      {isOffline && <div className="pwa-offline-banner" role="status" aria-live="polite"><WifiOff size={17} /><span><strong>You're offline.</strong> SchoolBridge's saved app shell is available. Use a prepared offline workspace for saved records; changes requiring the server need a connection.</span></div>}
      {!hideInstallCard && <aside className="pwa-install-card" aria-label="Install SchoolBridge">
      <div className="pwa-install-icon"><Download size={19} /></div>
      <div className="pwa-install-copy">
        {waitingWorker ? <><strong>SchoolBridge update ready</strong><span>Refresh the app to use the latest version.</span></> : <><strong>Use SchoolBridge like an app</strong><span>{isAppleMobile ? 'Add a SchoolBridge icon to your iPhone or iPad.' : 'Install SchoolBridge on this device for quick access.'}</span></>}
        {showAppleSteps && isAppleMobile && (
          <span className="pwa-apple-steps">In Safari, tap <Share size={14} aria-label="Share" /> Share, then choose <strong>Add to Home Screen</strong>.</span>
        )}
      </div>
      {waitingWorker ? (
        <button type="button" className="pwa-install-action" onClick={applyUpdate} disabled={applyingUpdate}>{applyingUpdate ? 'Updating…' : 'Update now'}</button>
      ) : installEvent ? (
        <button type="button" className="pwa-install-action" onClick={() => void install()}>Install</button>
      ) : (
        <button type="button" className="pwa-install-action" onClick={() => setShowAppleSteps(value => !value)}>
          {showAppleSteps ? 'Hide steps' : 'How to add'}
        </button>
      )}
      <button type="button" className="pwa-dismiss" aria-label="Dismiss install suggestion" onClick={() => setDismissed(true)}><X size={17} /></button>
      </aside>}
    </>
  )
}
