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
  const chromeDesktop=/\bchrome\//i.test(navigator.userAgent)&&!/\b(edg|opr)\//i.test(navigator.userAgent)&&!apple&&!android
  useEffect(()=>{
    const manifestLink=document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const previousManifest=manifestLink?.href
    let manifestObjectUrl=''
    if(manifestLink){
      const launch=new URL('/',window.location.origin)
      launch.searchParams.set('school',schoolId)
      launch.searchParams.set('audience',audience)
      const manifest={id:launch.pathname+launch.search,name:'SchoolBridge',short_name:'SchoolBridge',start_url:launch.pathname+launch.search,scope:'/',display:'standalone',orientation:'any',background_color:'#f5f7fb',theme_color:'#173b63',icons:[{src:'/icons/schoolbridge-app-icon.png',sizes:'192x192',type:'image/png'},{src:'/icons/schoolbridge-app-icon-512.png',sizes:'512x512',type:'image/png'},{src:'/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]}
      manifestObjectUrl=URL.createObjectURL(new Blob([JSON.stringify(manifest)],{type:'application/manifest+json'}))
      manifestLink.href=manifestObjectUrl
    }
    const capture=()=>setPromptEvent(window.schoolBridgeInstallPrompt||null)
    window.addEventListener('schoolbridge:install-prompt',capture)
    return()=>{window.removeEventListener('schoolbridge:install-prompt',capture);if(manifestLink&&previousManifest)manifestLink.href=previousManifest;if(manifestObjectUrl)URL.revokeObjectURL(manifestObjectUrl)}
  },[schoolId,audience])
  async function install(){
    setError('')
    if(!promptEvent) return
    try{
      await promptEvent.prompt()
      const choice=await promptEvent.userChoice
      setPromptEvent(null)
      window.schoolBridgeInstallPrompt=undefined
      if(choice.outcome==='accepted')setError('SchoolBridge was added. Open it from your Home Screen or app list.')
    }catch{setError('The install prompt could not be opened. Use your browser menu to install SchoolBridge, then open the installed app.')}
  }
  return <main className="login-page school-access-page">
    <section className="login-card school-access-card">
      <div className="brand-mark"><Download size={27}/></div>
      <div className="brand-name">School<span>Bridge</span></div>
      <p className="login-subtitle">{schoolName} · {audience==='parent'?'Parent':audience==='teacher'?'Teacher':'Staff'} access</p>
      <h1>Install SchoolBridge first</h1>
      <p className="muted">{audience==='staff'?'This is your school staff access link. Install and open the SchoolBridge PWA, then sign in with your school-issued staff credentials.':'This QR code is for the '+audience+'. Install and open the SchoolBridge PWA before entering your details. Your verification form will appear inside the installed app, not on this website.'}</p>
      {audience==='staff'?<div className="form-hint"><strong>{apple?'On iPhone or iPad':android?'On Android':chromeDesktop?'Add to Home Screen':'Add to Home Screen'}</strong><p>{apple?<>Open this staff link in Safari. Tap <Share size={14} aria-label="Share"/> Share, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>. Open SchoolBridge from your Home Screen and sign in with your school-issued staff credentials.</>:android?<>Tap the <strong>Install SchoolBridge</strong> button if it appears, or open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>. Open SchoolBridge from your Home Screen or app list and sign in with your school-issued staff credentials.</>:chromeDesktop?<>In Chrome, open the <strong>⋮</strong> menu and choose <strong>Add to Home Screen</strong>. Confirm the action, then open SchoolBridge from the Home Screen and sign in with your school-issued staff credentials. Open the installed app and sign in with your school-issued staff credentials.</>:<>Use your browser's <strong>Install</strong> or <strong>Add to Home Screen</strong> option. Open the installed SchoolBridge app and sign in with your school-issued staff credentials.</>}</p></div>:apple?<div className="form-hint"><strong>On iPhone or iPad</strong><p>Open this page in Safari. Tap <Share size={14} aria-label="Share"/> Share, choose <strong>Add to Home Screen</strong>, confirm, then open SchoolBridge from your Home Screen.</p></div>:android?<div className="form-hint"><strong>On Android</strong><p>Install SchoolBridge using the button below, or open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>. Then open SchoolBridge from your app list.</p></div>:<div className="form-hint"><strong>Use your phone</strong><p>Open this school QR link on your phone, install SchoolBridge from the browser's app-install option, then launch the installed app.</p></div>}
      <button type="button" className="primary-button login-button" onClick={()=>void install()} disabled={!promptEvent} aria-disabled={!promptEvent}>Add to Home Screen</button>
      {error&&<p className="form-hint" role="status">{error}</p>}
      <p className="login-foot">After installation, open SchoolBridge to {audience==='staff'?'sign in with your staff credentials':'complete '+audience+' verification'} for {schoolName}.</p>
    </section>
  </main>
}
