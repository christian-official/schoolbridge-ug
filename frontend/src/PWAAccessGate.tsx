import { useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'
import './App.css'

type Audience = 'parent' | 'teacher' | 'staff'
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export default function PWAAccessGate({schoolName,audience,schoolId}:{schoolName:string;audience:Audience;schoolId:string}) {
  const [promptEvent,setPromptEvent]=useState<InstallPrompt|null>(()=>window.schoolBridgeInstallPrompt||null)
  const [error,setError]=useState('')
  const apple=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)
  const android=/android/i.test(navigator.userAgent)
  const desktop=!apple&&!android
  const browser=navigator.userAgent
  const edgeDesktop=/\bedg\//i.test(browser)&&desktop
  const firefoxDesktop=/\bfirefox\//i.test(browser)&&desktop
  const safariDesktop=/\bsafari\//i.test(browser)&&!/\bchrome\//i.test(browser)&&!/\bedg\//i.test(browser)&&desktop
  const showInstallButton=!(audience==='staff'&&desktop&&!promptEvent)
  useEffect(()=>{
    // index.html selects the school-and-role-specific manifest before Chrome
    // evaluates installability. Do not replace it here: swapping manifests
    // after page load can prevent Chrome from offering its native prompt.
    const capture=()=>setPromptEvent(window.schoolBridgeInstallPrompt||null)
    window.addEventListener('schoolbridge:install-prompt',capture)
    capture()
    return()=>window.removeEventListener('schoolbridge:install-prompt',capture)
  },[])
  async function install(){
    setError('')
    if(!promptEvent){setError('Use your browser’s install option to add SchoolBridge to your computer.');return}
    try{
      await promptEvent.prompt()
      const choice=await promptEvent.userChoice
      setPromptEvent(null)
      window.schoolBridgeInstallPrompt=undefined
      if(choice.outcome==='accepted')setError('SchoolBridge was added. Open it from your Home Screen or app list.')
    }catch{setError('The install prompt could not be opened. Use your browser menu to install SchoolBridge, then open the installed app.')}
  }
  return <main className="login-page school-access-page" data-school-id={schoolId}>
    <section className="login-card school-access-card">
      <div className="brand-mark"><Download size={27}/></div>
      <div className="brand-name">School<span>Bridge</span></div>
      <p className="login-subtitle">{schoolName} · {audience==='parent'?'Parent':audience==='teacher'?'Teacher':'Staff'} access</p>
      <h1>Install SchoolBridge first</h1>
      <p className="muted">{audience==='staff'?'This is your school staff access link. Install and open the SchoolBridge PWA, then sign in with your school-issued staff credentials.':'This QR code is for the '+audience+'. Install and open the SchoolBridge PWA before entering your details. Your verification form will appear inside the installed app, not on this website.'}</p>
      {audience==='staff'?<div className="form-hint"><strong>{apple?'On iPhone or iPad':android?'On Android':'Install SchoolBridge on this computer'}</strong><p>{apple?<>Open this staff link in Safari. Tap <Share size={14} aria-label="Share"/> Share, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>. Open SchoolBridge from your Home Screen and sign in with your school-issued staff credentials.</>:android?<>Tap the <strong>Install SchoolBridge</strong> button if it appears, or open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>. Open SchoolBridge from your Home Screen or app list and sign in with your school-issued staff credentials.</>:edgeDesktop?<>In Microsoft Edge, select the <strong>App available</strong> icon in the address bar and choose <strong>Install</strong>. If it is not shown, open <strong>… → Apps → Install this site as an app</strong>.</>:firefoxDesktop?<>In Firefox for Windows 143 or later, select the <strong>Web apps</strong> icon in the address bar to add SchoolBridge to your taskbar and Start menu.</>:safariDesktop?<>On macOS Sonoma or later, choose <strong>File → Add to Dock</strong> in Safari.</>:<>Choose your browser’s <strong>Install app</strong> or <strong>Add to Home Screen</strong> option if available. Then open SchoolBridge and sign in with your school-issued staff credentials.</>}</p></div>:apple?<div className="form-hint"><strong>On iPhone or iPad</strong><p>Open this page in Safari. Tap <Share size={14} aria-label="Share"/> Share, choose <strong>Add to Home Screen</strong>, confirm, then open SchoolBridge from your Home Screen.</p></div>:android?<div className="form-hint"><strong>On Android</strong><p>Install SchoolBridge using the button below, or open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>. Then open SchoolBridge from your app list.</p></div>:<div className="form-hint"><strong>Use your phone</strong><p>Open this school QR link on your phone, install SchoolBridge from the browser's app-install option, then launch the installed app.</p></div>}
      {showInstallButton&&<button type="button" className="primary-button login-button" onClick={()=>void install()}>Add to Home Screen</button>}
      {error&&<p className="form-hint" role="status">{error}</p>}
      <p className="login-foot">After installation, open SchoolBridge to {audience==='staff'?'sign in with your staff credentials':'complete '+audience+' verification'} for {schoolName}.</p>
    </section>
  </main>
}
