import { useEffect, useRef, useState } from 'react'
import { Download, Share, WifiOff, X } from 'lucide-react'
import './PWAInstallPrompt.css'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [installError, setInstallError] = useState('')
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine)
  const [isAppleMobile, setIsAppleMobile] = useState(false)
  const [isAndroid, setIsAndroid] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [showAppleSteps, setShowAppleSteps] = useState(false)
  const [showDesktopSteps, setShowDesktopSteps] = useState(false)
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
    setIsAndroid(/android/i.test(navigator.userAgent))
    setIsDesktop(!appleMobile && !/android/i.test(navigator.userAgent))

    const handleInstallPrompt = (event?: Event) => {
      const promptEvent = (event ?? window.schoolBridgeInstallPrompt) as InstallPromptEvent | undefined
      if (!promptEvent) return
      setInstallError('')
      setInstallEvent(promptEvent)
    }
    const handleInstalled = () => {
      setInstallEvent(null)
      setDismissed(true)
    }

    window.addEventListener('schoolbridge:install-prompt', handleInstallPrompt)
    handleInstallPrompt()
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('schoolbridge:install-prompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  async function install() {
    const promptEvent = installEvent
    if (!promptEvent) return

    setInstallError('')
    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      setInstallEvent(null)
      window.schoolBridgeInstallPrompt = undefined
      if (choice.outcome === 'accepted') setDismissed(true)
    } catch {
      setInstallEvent(null)
      window.schoolBridgeInstallPrompt = undefined
      setInstallError('SchoolBridge could not open the install prompt. Please try again later or continue in your browser.')
    }
  }

  const hideInstallCard = (dismissed && !waitingWorker) ||
    (!installEvent && !isAppleMobile && !isAndroid && !isDesktop && !waitingWorker)
  if (hideInstallCard && !isOffline) return null

  return (
    <>
      {isOffline && <div className="pwa-offline-banner" role="status" aria-live="polite"><WifiOff size={17} /><span><strong>You're offline.</strong> SchoolBridge's saved app shell is available. Use a prepared offline workspace for saved records; changes requiring the server need a connection.</span></div>}
      {!hideInstallCard && <aside className="pwa-install-card" aria-label="Install SchoolBridge">
        <div className="pwa-install-icon"><Download size={19} /></div>
        <div className="pwa-install-copy">
          {waitingWorker ? <><strong>SchoolBridge update ready</strong><span>Refresh the app to use the latest version.</span></> :
            isAppleMobile ? <><strong>Add SchoolBridge to your Home Screen</strong><span>Install from Safari to open SchoolBridge like an app.</span></> :
              installEvent ? <><strong>Install SchoolBridge</strong><span>Add the app to your device for quick access.</span></> :
                isDesktop ? <><strong>Install SchoolBridge on this computer</strong><span>Use your browser’s install option to add SchoolBridge to your apps.</span></> :
                  <><strong>SchoolBridge is ready to use</strong><span>{isAndroid ? 'This browser has not provided an install prompt. Check its app-install controls, or continue using SchoolBridge here.' : 'You can keep using SchoolBridge in this browser.'}</span></>}
          {showAppleSteps && isAppleMobile && (
            <span className="pwa-apple-steps">In Safari, tap <Share size={14} aria-label="Share" /> Share, then choose <strong>Add to Home Screen</strong>.</span>
          )}
          {showDesktopSteps && isDesktop && !installEvent && <span className="pwa-android-steps">{/edg\//i.test(navigator.userAgent) ? <>In Edge, open <strong>… → Apps → Install this site as an app</strong>.</> : /firefox\//i.test(navigator.userAgent) ? <>In Firefox for Windows 143+, use the <strong>Web apps</strong> icon in the address bar.</> : /safari/i.test(navigator.userAgent) && !/chrome|edg/i.test(navigator.userAgent) ? <>In Safari on macOS Sonoma or later, choose <strong>File → Add to Dock</strong>.</> : <>In Chrome, open <strong>⋮ → Cast, save, and share → Install page as app</strong>. If that option is unavailable, check your browser’s app-install menu.</>}</span>}
          {installError && <span className="pwa-install-error" role="status">{installError}</span>}
        </div>
        {waitingWorker ? (
          <button type="button" className="pwa-install-action" onClick={applyUpdate} disabled={applyingUpdate}>{applyingUpdate ? 'Updating…' : 'Update now'}</button>
        ) : installEvent ? (
          <button type="button" className="pwa-install-action" onClick={() => void install()}>Install</button>
        ) : isDesktop ? (
          <button type="button" className="pwa-install-action" onClick={() => setShowDesktopSteps(value => !value)}>{showDesktopSteps ? 'Hide steps' : 'Install options'}</button>
        ) : isAppleMobile ? (
          <button type="button" className="pwa-install-action" onClick={() => setShowAppleSteps(value => !value)}>
            {showAppleSteps ? 'Hide steps' : 'Add to Home Screen'}
          </button>
        ) : null}
        <button type="button" className="pwa-dismiss" aria-label="Dismiss install suggestion" onClick={() => setDismissed(true)}><X size={17} /></button>
      </aside>}
    </>
  )
}
