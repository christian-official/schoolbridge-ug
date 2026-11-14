import { useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'
import './App.css'

type Audience = 'parent' | 'teacher'
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

declare global {
  interface Window { schoolBridgeInstallPrompt?: InstallPrompt }
}

export default function PWAAccessGate({schoolName,audience}:{schoolName:string;audience:Audience}) {
  const [promptEvent,setPromptEvent]=useState<InstallPrompt|null>(()=>window.schoolBridgeInstallPrompt||null)
  const [error,setError]=useState('')
  const apple=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)
  const android=/android/i.test(navigator.userAgent)
  useEffect(()=>{
    const capture=()=>setPromptEvent(window.schoolBridgeInstallPrompt||null)
    window.addEventListener('schoolbridge:install-prompt',capture)
    return()=>window.removeEventListener('schoolbridge:install-prompt',capture)
  },[])
  async function install(){
    if(!promptEvent)return
    setError('')
    try{
      await promptEvent.prompt()
      const choice=await promptEvent.userChoice
      setPromptEvent(null)
      window.schoolBridgeInstallPrompt=undefined
      if(choice.outcome==='accepted')setError('SchoolBridge is installing. When it finishes, open it from your Home Screen or app list to complete your verification.')
    }catch{setError('The install prompt could not be opened. Use your browser menu to install SchoolBridge, then open the installed app.')}
  }
  return <main className="login-page school-access-page">
    <section className="login-card school-access-card">
      <div className="brand-mark"><Download size={27}/></div>
      <div className="brand-name">School<span>Bridge</span></div>
      <p className="login-subtitle">{schoolName} · {audience==='parent'?'Parent':'Teacher'} mobile access</p>
      <h1>Install SchoolBridge first</h1>
      <p className="muted">This QR code is for the {audience}. Install and open the SchoolBridge app experience before entering your details. Your verification form will appear inside the installed app, not on this website.</p>
      {apple?<div className="form-hint"><strong>On iPhone or iPad</strong><p>Open this page in Safari. Tap <Share size={14} aria-label="Share"/> Share, choose <strong>Add to Home Screen</strong>, confirm, then open SchoolBridge from your Home Screen.</p></div>:android?<div className="form-hint"><strong>On Android</strong><p>Install SchoolBridge using the button below, or open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>. Then open SchoolBridge from your app list.</p></div>:<div className="form-hint"><strong>Use your phone</strong><p>Open this school QR link on your phone, install SchoolBridge from the browser's app-install option, then launch the installed app.</p></div>}
      {promptEvent&&<button type="button" className="primary-button login-button" onClick={()=>void install()}>Install SchoolBridge</button>}
      {error&&<p className="form-hint" role="status">{error}</p>}
      <p className="login-foot">After installation, open SchoolBridge to complete {audience} verification for {schoolName}.</p>
    </section>
  </main>
}
