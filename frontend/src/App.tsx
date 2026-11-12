import { fetchSchoolBridge } from './offlineNetwork'
import { useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  FileText, Settings, LogOut,
  Search, Plus, Menu, X, ArrowUpRight, UserPlus,
  CalendarDays, TrendingUp, ShieldCheck, LoaderCircle, RefreshCw,
  Contact, Megaphone, Briefcase, Clock, FolderOpen, CalendarCheck, CheckCircle2, UserX, MessageSquareText, Wifi, WifiOff,
} from 'lucide-react'
import StaffFinance from './StaffFinance'
import AcademicManagement from './AcademicManagement'
import AttendanceHub from './AttendanceHub'
import MyStaffProfile from './MyStaffProfile'
import OperationsManagement from './OperationsManagement'
import Phase4Workspace from './Phase4Workspace'
import ParentLiaisonWorkspace from './ParentLiaison'
import SyncDevices from './SyncDevices'
import RegistrationFlow from './RegistrationFlow'
import { clearLocalSyncData, saveEncryptedOfflineDraft, loadEncryptedOfflineDraft, deleteEncryptedOfflineDraft, loadEncryptedOfflineSnapshot, deleteEncryptedOfflineSnapshot } from './syncStorage'
import './App.css'
import './DashboardRedesign.css'

type User = {
  id: number
  username: string
  email: string
  role: string
  role_label?: string
  permissions?: Record<string, string[]>
  active: boolean
  must_change_password?: boolean
}

type StudentPage = { items: RecordItem[]; total: number; page: number; pages: number }

type FinanceDashboardSummary = { fees_expected: number; fees_collected: number; outstanding: number }

type DashboardSummary = {
  active_students: number
  new_admissions_this_year: number
  students_present_today: number
  active_staff: number
  total_classes: number
  academic_year: number
}

type AdmissionSettings = {
  admission_prefix: string
  include_year: boolean
  admission_separator: string
  admission_padding: number
  next_admission_number: number
}

type RecordItem = {
  id: number
  name?: string
  first_name?: string
  last_name?: string
  admission_number?: string
  section?: string
  gender?: string
  class_id?: number | null
  date_of_birth?: string | null
  photo_data?: string | null
}

const menu = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Students', icon: GraduationCap },
  { label: 'Staff', icon: Users },
  { label: 'Fees & Finance', icon: FileText },
  { label: 'Examinations', icon: FileText },
  { label: 'Attendance', icon: CalendarDays },
  { label: 'Timetable', icon: CalendarDays },
  { label: 'Leadership & Duty', icon: ShieldCheck },
  { label: 'Parent Access', icon: Users },
  { label: 'Announcements', icon: FileText },
  { label: 'Parent Liaison', icon: MessageSquareText },
  { label: 'School Community', icon: Users },
]
const teacherMenu = [
  { label: 'My Classes', icon: BookOpen },
  { label: 'Attendance', icon: CalendarDays },
  { label: 'My Attendance', icon: Users },
  { label: 'My Results', icon: FileText },
  { label: 'Timetable', icon: CalendarDays },
  { label: 'Announcements', icon: FileText },
]
const parentMenu = [
  { label: 'My Children', icon: GraduationCap },
  { label: 'Announcements', icon: FileText },
  { label: 'Parent Liaison', icon: MessageSquareText },
  { label: 'Device Management', icon: Wifi },
]

function isFinanceAccount(user:User) {
  if (user.role === 'admin') return false
  const label = (user.role_label || '').toLowerCase()
  const permissions = user.permissions || {}
  const financeRole = /bursar|accountant|finance|accounts/.test(label)
  const financeOnlyAccess = (permissions['Fees & Finance'] || []).includes('view') &&
    !['My Classes','My Results','My Attendance','Attendance','Staff Attendance','Examinations','Timetable','Leadership & Duty','Students','Staff','Parent Access','Parent Liaison','Announcements'].some(section => (permissions[section] || []).includes('view'))
  return financeRole || financeOnlyAccess
}

function getStaffNavigation(user:User) {
  const allItems = [...menu, ...teacherMenu.filter(item => !menu.some(base => base.label === item.label))]
  const visible = allItems.filter(item =>
    item.label === 'Overview' ||
    item.label === 'My Attendance' ||
    (user.permissions?.[item.label] || []).includes('view') ||
    (item.label === 'Attendance' && (user.permissions?.['Staff Attendance'] || []).includes('view'))
  )
  const role = (user.role_label || '').toLowerCase()
  const priority = /school administrator|system administrator|^administrator$/.test(role)
    ? ['Overview','Students','Staff','Examinations','Attendance','Fees & Finance','Timetable','Leadership & Duty','Parent Access','Parent Liaison','Announcements','Reports','My Attendance']
    : /teacher|head\s?teacher/.test(role)
    ? ['Overview','My Classes','My Results','Timetable','Attendance','My Attendance','Parent Liaison','Announcements','My Profile']
    : /secretary|office administrator/.test(role)
    ? ['Overview','Students','Staff','Parent Access','Parent Liaison','Announcements','Reports','My Attendance','My Profile']
    : /attendance/.test(role)
      ? ['Overview','Attendance','My Attendance','Staff','Reports','Announcements','My Profile']
      : /bursar|accountant|finance|accounts/.test(role)
        ? ['Overview','Fees & Finance','My Attendance','My Profile']
        : /academic|director of studies|\bdos\b|deputy|headteacher|examination/.test(role)
          ? ['Overview','Timetable','Staff','Examinations','Attendance','Students','Reports','Announcements','My Attendance','My Profile']
          : ['Overview','Staff','Attendance','Timetable','Leadership & Duty','Announcements','Reports','My Attendance','My Profile']
  return visible.sort((a,b) => {
    const ai=priority.indexOf(a.label), bi=priority.indexOf(b.label)
    return (ai<0?999:ai)-(bi<0?999:bi)
  })
}

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
// Tauri's Windows WebView uses the tauri.localhost origin. The desktop app
// always talks to its own loopback backend, never to a hosted school server.
const isTauriDesktop = typeof window !== 'undefined' && (
  '__TAURI_INTERNALS__' in window ||
  window.location.hostname === 'tauri.localhost' ||
  window.location.protocol === 'tauri:'
)
const desktopApiBaseUrl = isTauriDesktop ? 'http://127.0.0.1:8080' : ''
function isPrivateLanAddress(hostname: string): boolean {
  const octets = hostname.split('.').map(part => /^\d{1,3}$/.test(part) ? Number(part) : -1)
  if (octets.length !== 4 || octets.some(part => part < 0 || part > 255)) return false
  const [first, second] = octets
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}
const isSchoolBridgeLanClient = typeof window !== 'undefined' &&
  window.location.protocol === 'https:' && isPrivateLanAddress(window.location.hostname)
// Hosted deployments set VITE_API_BASE_URL at build time; local and LAN installs use same-origin APIs.
declare global {
  interface Window {
    __TAURI__?: { core?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } }
  }
}

async function loadStoredSessionToken(): Promise<string> {
  if (isTauriDesktop) {
    const invoke = window.__TAURI__?.core?.invoke
    if (!invoke) throw new Error('Secure desktop credential storage is unavailable.')
    return (await invoke<string | null>('load_auth_token')) || ''
  }
  return sessionStorage.getItem('sb_token') || ''
}

async function storeSessionToken(token: string): Promise<void> {
  if (isTauriDesktop) {
    const invoke = window.__TAURI__?.core?.invoke
    if (!invoke) throw new Error('Secure desktop credential storage is unavailable.')
    await invoke<void>('store_auth_token', { token })
    return
  }
  sessionStorage.setItem('sb_token', token)
}

async function clearStoredSessionToken(): Promise<void> {
  if (isTauriDesktop) {
    const invoke = window.__TAURI__?.core?.invoke
    if (!invoke) throw new Error('Secure desktop credential storage is unavailable.')
    await invoke<void>('clear_auth_token')
    return
  }
  sessionStorage.removeItem('sb_token')
}

const API_BASE_URL = desktopApiBaseUrl || (isSchoolBridgeLanClient ? '' : configuredApiBaseUrl)

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetchSchoolBridge(`${API_BASE_URL}/api/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    if (error instanceof TypeError || !navigator.onLine) {
      throw new TypeError('SchoolBridge cannot reach the server right now. Your prepared offline workspace remains available; reconnect to refresh live records.')
    }
    throw error
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status >= 500) throw new TypeError('SchoolBridge server is temporarily unavailable.')
    throw new Error(result.detail || `Request failed: ${response.status}`)
  }
  return result as T
}

function PasswordRecovery({onBack,schoolId}:{onBack:()=>void;schoolId:string}) {
  const [stage,setStage]=useState<'request'|'confirm'>('request')
  const [identifier,setIdentifier]=useState('')
  const [code,setCode]=useState('')
  const [newPassword,setNewPassword]=useState('')
  const [confirmPassword,setConfirmPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  async function requestCode(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');setMessage('')
    try {
      const response=await fetchSchoolBridge(`${API_BASE_URL}/api/auth/password-reset/request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,school_id:schoolId||undefined})})
      const data=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(data.detail||'Unable to request a recovery code.')
      setMessage(data.message||'If the account has a registered email, a code will be sent. Check your inbox and spam folder.')
      setStage('confirm')
    } catch(e){setError(e instanceof Error?e.message:'Unable to request a recovery code.')}
    finally{setBusy(false)}
  }
  async function confirmReset(e:React.FormEvent){
    e.preventDefault();setError('');setMessage('')
    if(newPassword!==confirmPassword){setError('The new passwords do not match.');return}
    setBusy(true)
    try {
      const response=await fetchSchoolBridge(`${API_BASE_URL}/api/auth/password-reset/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,school_id:schoolId||undefined,code,new_password:newPassword})})
      const data=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(data.detail||'Password reset failed.')
      setMessage(data.message||'Password reset successfully. You can now sign in.')
      setCode('');setNewPassword('');setConfirmPassword('')
      setTimeout(onBack,1200)
    } catch(e){setError(e instanceof Error?e.message:'Password reset failed.')}
    finally{setBusy(false)}
  }
  return <div className="password-recovery">
    <h2>{stage==='request'?'Recover your password':'Enter verification code'}</h2>
    <p className="muted">{stage==='request'?'Enter your username, staff number, surname or registered email address.':'Enter the six-digit code sent to your registered email address.'}</p>
    <p className="form-hint">If no code arrives, contact your school administrator. Email recovery requires the school's email service to be configured.</p>
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="success-notice" role="status">{message}</p>}
    {stage==='request'?<form onSubmit={requestCode}>
      <label htmlFor="recovery-identifier">Account identifier</label><input id="recovery-identifier" value={identifier} onChange={e=>setIdentifier(e.target.value)} autoComplete="username" required placeholder="Staff number, surname or email"/>
      <button className="primary-button login-button" disabled={busy}>{busy?'Sending request...':'Send recovery code'}</button>
    </form>:<form onSubmit={confirmReset}>
      <label htmlFor="recovery-code">Verification code</label><input id="recovery-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} placeholder="6-digit code"/>
      <label htmlFor="recovery-new-password">New password</label><input id="recovery-new-password" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" required minLength={8}/>
      <label htmlFor="recovery-confirm-password">Confirm new password</label><input id="recovery-confirm-password" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" required minLength={8}/>
      <button className="primary-button login-button" disabled={busy}>{busy?'Updating...':'Set new password'}</button>
      <button type="button" className="secondary-button recovery-secondary" disabled={busy} onClick={()=>{setStage('request');setMessage('')}}>Request another code</button>
    </form>}
    <button type="button" className="recovery-back" onClick={onBack}>Back to sign in</button>
  </div>
}

function ForcePasswordChange({token,username,onComplete}:{token:string;username:string;onComplete:()=>void}) {
  const [currentPassword,setCurrentPassword]=useState('')
  const [newPassword,setNewPassword]=useState('')
  const [confirmPassword,setConfirmPassword]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  async function submit(e:React.FormEvent){
    e.preventDefault();setError('')
    if(newPassword!==confirmPassword){setError('The new passwords do not match.');return}
    if(newPassword.length<8){setError('Use at least 8 characters for your new password.');return}
    setBusy(true)
    try{await api('me/password',token,{method:'PUT',body:JSON.stringify({current_password:currentPassword,new_password:newPassword})});onComplete()}
    catch(e){setError(e instanceof Error?e.message:'Unable to update password.')}
    finally{setBusy(false)}
  }
  return <main className="login-page"><section className="login-card">
    <div className="brand-mark"><ShieldCheck size={30}/></div><div className="brand-name">School<span>Bridge</span></div>
    <h1>Change your temporary password</h1><p className="muted">Hello {username}. Your account has a temporary passcode. Set a private password before continuing.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    <form onSubmit={submit}>
      <label htmlFor="temporary-password">Temporary passcode</label><input id="temporary-password" type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} autoComplete="current-password" required/>
      <label htmlFor="new-password">New password</label><input id="new-password" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} required/>
      <label htmlFor="confirm-new-password">Confirm new password</label><input id="confirm-new-password" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required/>
      <button className="primary-button login-button" disabled={busy}>{busy?'Updating...':'Save new password'}</button>
    </form>
    <p className="login-foot"><ShieldCheck size={15}/> Your temporary passcode will stop working after this change.</p>
  </section></main>
}

type PersonalDashboardData = {
  staff_name: string
  role_label: string
  available_sections: string[]
  today_lessons: {class_id:number|null;class_name:string;subject:string;start_time:string;end_time:string}[]
  class_teacher_classes: {class_id:number;class_name:string}[]
  today_duty: {date:string;notes:string}|null
}
function PersonalDashboard({token,username,onNavigate}:{token:string;username:string;onNavigate:(section:string)=>void}) {
  const [data,setData]=useState<PersonalDashboardData|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [refreshCount,setRefreshCount]=useState(0)
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    api<PersonalDashboardData>('dashboard/my-work',token).then(result=>{if(!cancelled)setData(result)})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Unable to load your assigned work.')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return ()=>{cancelled=true}
  },[token,refreshCount])
  const roleName=(data?.role_label||'').toLowerCase()
  const isAcademicAccount=/teacher|academic|director of studies|\bdos\b|head teacher|deputy|examinations officer/.test(roleName)
  const workCount=(isAcademicAccount?(data?.today_lessons.length||0)+(data?.class_teacher_classes.length||0):0)+(data?.today_duty?1:0)
  return <div className="role-dashboard staff-account-dashboard">
    <section className="panel">
      <div className="panel-heading"><div><h2>{isAcademicAccount?'Academic & teaching overview':'Your responsibilities overview'}</h2><p>{data?.staff_name||username} · {data?.role_label||'Staff account'} · Only work and areas assigned to your account are shown.</p></div><div className="dashboard-heading-actions"><span className="count-pill">{workCount} active items today</span><button type="button" className="secondary-button" onClick={()=>setRefreshCount(value=>value+1)} disabled={loading}>{loading?'Refreshing...':'Refresh data'}</button></div></div>
      {loading&&<p className="form-hint">Loading your assigned work...</p>}
      {error&&<div className="form-error" role="alert">{error}</div>}
      {data&&!loading&&<>
        {data.today_duty&&<div className="quick-action"><span className="quick-icon purple"><ShieldCheck/></span><span><strong>Today's assigned duty</strong><small>{data.today_duty.notes}</small></span></div>}
        {isAcademicAccount&&data.today_lessons.length>0&&<><h3>Today's teaching timetable</h3><div className="table-wrap"><table><thead><tr><th>Time</th><th>Class</th><th>Subject</th></tr></thead><tbody>{data.today_lessons.map((lesson,index)=><tr key={index}><td>{lesson.start_time}–{lesson.end_time}</td><td>{lesson.class_name}</td><td>{lesson.subject}</td></tr>)}</tbody></table></div></>}
        {isAcademicAccount&&data.class_teacher_classes.length>0&&<><h3>Your class-teacher responsibilities</h3><div className="class-grid">{data.class_teacher_classes.map(item=><div className="class-card" key={item.class_id}><Users size={20}/><strong>{item.class_name}</strong><span>Class attendance responsibility</span></div>)}</div></>}
        {workCount===0&&<div className="empty-state"><CalendarDays size={30}/><p>{isAcademicAccount?'No lessons or duty assignments are scheduled for you today.':'No duty has been assigned to you for today.'}</p><small>Your available work areas are listed below.</small></div>}
        <h3>Work areas you can access</h3>
        <div className="overview-leadership-grid">{data.available_sections.filter(section=>section!=='Overview').map(section=><button type="button" className="leadership-shortcut" key={section} onClick={()=>onNavigate(section)}><span className="quick-icon blue"><ArrowUpRight/></span><span><strong>{section}</strong><small>Open your authorised {section.toLowerCase()} workspace.</small></span><ArrowUpRight size={16}/></button>)}</div>
        {!data.available_sections.length&&<p className="form-hint">No school work areas have been assigned. Contact the administrator.</p>}
      </>}
    </section>
  </div>
}

function TeacherDashboard({token,username: _username,onNavigate}:{token:string;username:string;onNavigate:(section:string)=>void}) {
  const [data,setData]=useState<PersonalDashboardData|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [refreshCount,setRefreshCount]=useState(0)
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    api<PersonalDashboardData>('dashboard/my-work',token).then(result=>{if(!cancelled)setData(result)})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Unable to load your teaching workspace.')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[token,refreshCount])
  const sections=(data?.available_sections||[]).filter(section=>section!=='Overview')
  const shortcuts=[
    {section:'My Classes',title:'My classes & learners',description:'Open your assigned classes and view the learners linked to your teaching work.',icon:<Users/>,tone:'blue'},
    {section:'My Results',title:'Marks & results',description:'Select an examination and your registered subjects, submit scores and monitor verification status.',icon:<FileText/>,tone:'purple'},
    {section:'Timetable',title:'Teaching timetable',description:'View the school timetable and the lessons assigned to you.',icon:<CalendarDays/>,tone:'green'},
    {section:'Attendance',title:'Class attendance',description:'Record and review attendance for the classes you are authorised to manage.',icon:<CalendarCheck/>,tone:'amber'},
    {section:'My Attendance',title:'My staff attendance',description:'Check in, check out and review your own recorded shifts.',icon:<Clock/>,tone:'blue'},
    {section:'Announcements',title:'School announcements',description:'Read important updates shared by the school.',icon:<Megaphone/>,tone:'purple'},
  ].filter(item=>sections.includes(item.section))
  return <div className="teacher-workspace-dashboard">
    <section className="teacher-workspace-hero"><div><p className="eyebrow">TEACHING & LEARNING · PERSONAL WORKSPACE</p><h2>Welcome, Teacher!</h2><p>Teach. Assess. Inspire. Your assigned classes, teaching activities and academic tools.</p></div><button type="button" className="secondary-button" onClick={()=>setRefreshCount(v=>v+1)} disabled={loading}><RefreshCw size={15}/>{loading?'Refreshing...':'Refresh workspace'}</button></section>
    {loading&&<p className="form-hint">Loading your assigned teaching work...</p>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {data&&!loading&&<>
      <section className="teacher-workspace-metrics"><div><small>LESSONS TODAY</small><strong>{data.today_lessons.length}</strong><span>Scheduled teaching periods</span></div><div><small>CLASS RESPONSIBILITIES</small><strong>{data.class_teacher_classes.length}</strong><span>Class-teacher assignments</span></div><div><small>AVAILABLE WORKSPACES</small><strong>{shortcuts.length}</strong><span>Authorised teaching tools</span></div></section>
      <section className="teacher-workspace-layout">
        <div className="teacher-workspace-main">
          <section className="panel"><div className="panel-heading"><div><h3>Today's teaching timetable</h3><p>Your scheduled lessons from the school timetable.</p></div><button type="button" className="secondary-button" onClick={()=>onNavigate('Timetable')}>Open timetable <ArrowUpRight size={15}/></button></div>
            {data.today_lessons.length?<div className="table-wrap"><table><thead><tr><th>Time</th><th>Class</th><th>Subject</th></tr></thead><tbody>{data.today_lessons.map((lesson,index)=><tr key={index}><td>{lesson.start_time}–{lesson.end_time}</td><td>{lesson.class_name}</td><td>{lesson.subject}</td></tr>)}</tbody></table></div>:<div className="empty-state"><CalendarDays size={26}/><p>No lessons are scheduled for you today.</p></div>}
          </section>
          <section className="panel"><div className="panel-heading"><div><h3>Class-teacher responsibilities</h3><p>Classes assigned to you for class-level administration.</p></div><button type="button" className="secondary-button" onClick={()=>onNavigate('My Classes')}>Open my classes <ArrowUpRight size={15}/></button></div>
            {data.class_teacher_classes.length?<div className="teacher-class-responsibilities">{data.class_teacher_classes.map(item=><button type="button" className="teacher-class-card" key={item.class_id} onClick={()=>onNavigate('My Classes')}><GraduationCap size={20}/><strong>{item.class_name}</strong><span>Class attendance & learner records</span></button>)}</div>:<div className="empty-state"><Users size={25}/><p>No class-teacher responsibility is assigned to your account.</p></div>}
          </section>
        </div>
        <aside className="panel teacher-tools-panel"><div className="panel-heading"><div><h3>Teaching tools</h3><p>Open your assigned work.</p></div></div>
          {shortcuts.length?<div className="teacher-tool-list">{shortcuts.map(item=><button type="button" className="teacher-tool-link" key={item.section} onClick={()=>onNavigate(item.section)}><span className={`teacher-tool-icon ${item.tone}`}>{item.icon}</span><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowUpRight size={16}/></button>)}</div>:<div className="empty-state"><Briefcase size={26}/><p>No teaching workspaces have been assigned.</p><small>Contact the administrator if an area is missing.</small></div>}
        </aside>
      </section>
    </>}
  </div>
}

type AdminExamRecord = {id:number;name:string;exam_type?:string;term?:string;year?:number;class_id:number;class_name?:string}
type AdminMarkRecord = {id:number;verified:boolean;score:number;subject_id:number}
function AdministratorDashboard({token,username: _username,onNavigate,summary,financeSummary,availableSections}:{token:string;username:string;onNavigate:(section:string)=>void;summary:DashboardSummary;financeSummary:FinanceDashboardSummary;availableSections:string[]}) {
  const [examRecords,setExamRecords]=useState<{exam:AdminExamRecord;marks:AdminMarkRecord[]}[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refreshCount,setRefreshCount]=useState(0)
  const can=(section:string)=>availableSections.includes(section)
  useEffect(()=>{
    let cancelled=false
    const load=async()=>{
      setLoading(true);setError('')
      try{
        const exams=can('Examinations')?await api<AdminExamRecord[]>('exams',token):[]
        const recent=exams.slice(-6).reverse()
        const records=await Promise.all(recent.map(async exam=>({exam,marks:await api<AdminMarkRecord[]>(`marks?exam_id=${exam.id}`,token)})))
        if(!cancelled)setExamRecords(records)
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Some academic indicators could not be loaded.')}
      finally{if(!cancelled)setLoading(false)}
    }
    void load()
    return()=>{cancelled=true}
  },[token,refreshCount,availableSections.join('|')])
  const allMarks=examRecords.flatMap(item=>item.marks)
  const pending=allMarks.filter(mark=>!mark.verified).length
  const verified=allMarks.filter(mark=>mark.verified).length
  const attendanceRate=summary.active_students>0?Math.round(summary.students_present_today/summary.active_students*100):0
  const absent=Math.max(0,summary.active_students-summary.students_present_today)
  const performance=examRecords.map(({exam,marks})=>({
    label:exam.exam_type||exam.name||'Exam',
    average:marks.length?Math.round(marks.reduce((total,mark)=>total+Number(mark.score||0),0)/marks.length):0,
    count:marks.length,
    pending:marks.filter(mark=>!mark.verified).length
  })).filter(item=>item.count>0).reverse()
  const priorities=[
    {section:'Students',title:'Learner records',description:'Admissions, student profiles and class organisation.',icon:<GraduationCap/>},
    {section:'Staff',title:'Staff management',description:'Teaching and non-teaching staff records and accounts.',icon:<Users/>},
    {section:'Examinations',title:'Academic oversight',description:'Examination cycles, submitted results and verification.',icon:<BookOpen/>},
    {section:'Attendance',title:'Attendance control',description:'School-wide learner attendance and follow-up.',icon:<CalendarCheck/>},
    {section:'Fees & Finance',title:'Finance overview',description:'Collections, outstanding balances and payment activity.',icon:<TrendingUp/>},
    {section:'Parent Access',title:'Parent access',description:'Parent accounts and linked learners.',icon:<Contact/>},
    {section:'Announcements',title:'School communication',description:'Publish and review school announcements.',icon:<Megaphone/>},
    {section:'Reports',title:'School reports',description:'Open authorised management reports.',icon:<FolderOpen/>}
  ].filter(item=>can(item.section))
  const alerts=[
    ...(pending>0?[{title:'Results awaiting verification',detail:`${pending} submitted score records need academic review.`,section:'Examinations',tone:'amber'}]:[]),
    ...(absent>0?[{title:'Learners not marked present',detail:`${absent} of ${summary.active_students} active learners are not currently recorded present today.`,section:'Attendance',tone:'blue'}]:[]),
    ...(!can('Fees & Finance')?[{title:'Finance access not assigned',detail:'Financial figures are hidden because this account has no finance permission.',section:'',tone:'slate'}]:[])
  ]
  return <div className="administrator-command-dashboard">
    <section className="admin-command-hero">
      <div><span className="admin-live-label"><i/> SCHOOL-WIDE MANAGEMENT</span><h2>Welcome, Administrator!</h2><p>Manage your school efficiently. Live enrolment, attendance, academic and financial indicators.</p></div>
      <div className="admin-hero-actions"><span className="admin-role-pill"><ShieldCheck size={15}/> School Administrator</span><button type="button" className="secondary-button" onClick={()=>setRefreshCount(v=>v+1)} disabled={loading}><RefreshCw size={15}/>{loading?'Updating':'Refresh dashboard'}</button></div>
    </section>
    <section className="admin-kpi-grid">
      <div className="admin-kpi-card"><span className="admin-kpi-icon blue"><GraduationCap/></span><div><small>TOTAL LEARNERS</small><strong>{summary.active_students.toLocaleString('en-UG')}</strong><span>Currently enrolled</span></div></div>
      <div className="admin-kpi-card"><span className="admin-kpi-icon violet"><Users/></span><div><small>ACTIVE STAFF</small><strong>{summary.active_staff.toLocaleString('en-UG')}</strong><span>Teaching & non-teaching</span></div></div>
      <div className="admin-kpi-card"><span className="admin-kpi-icon green"><CalendarCheck/></span><div><small>ATTENDANCE TODAY</small><strong>{attendanceRate}%</strong><span>{summary.students_present_today} learners present</span></div></div>
      <div className="admin-kpi-card"><span className="admin-kpi-icon amber"><BookOpen/></span><div><small>SCHOOL CLASSES</small><strong>{summary.total_classes.toLocaleString('en-UG')}</strong><span>Active classes & streams</span></div></div>
    </section>
    <section className="admin-dashboard-main-grid">
      <div className="admin-dashboard-primary">
        <article className="admin-dashboard-panel admin-attendance-panel">
          <div className="admin-panel-heading"><div><span className="admin-section-kicker">SCHOOL-WIDE ATTENDANCE</span><h3>Today's attendance</h3></div><button type="button" className="admin-text-link" onClick={()=>onNavigate('Attendance')}>Open register <ArrowUpRight size={15}/></button></div>
          <div className="admin-attendance-content"><div className="admin-attendance-ring" style={{'--attendance-rate':`${attendanceRate}%`} as React.CSSProperties}><div><strong>{attendanceRate}%</strong><small>Present</small></div></div><div className="admin-attendance-breakdown"><div><span><i className="present-dot"/>Present</span><strong>{summary.students_present_today}</strong></div><div><span><i className="absent-dot"/>Not marked present</span><strong>{absent}</strong></div><div><span><i className="class-dot"/>Active learners</span><strong>{summary.active_students}</strong></div></div></div>
        </article>
        <article className="admin-dashboard-panel admin-performance-panel">
          <div className="admin-panel-heading"><div><span className="admin-section-kicker">ACADEMIC PERFORMANCE</span><h3>Examination performance trend</h3><p>Average recorded marks across recent examinations</p></div>{can('Examinations')&&<button type="button" className="admin-text-link" onClick={()=>onNavigate('Examinations')}>View exams <ArrowUpRight size={15}/></button>}</div>
          {loading?<p className="admin-muted-state">Loading examination performance…</p>:error?<p className="admin-muted-state">{error}</p>:performance.length?<div className="admin-performance-chart">{performance.map((item,index)=><div className="admin-performance-column" key={`${item.label}-${index}`}><div className="admin-performance-bar-track"><div className="admin-performance-bar" style={{height:`${Math.max(4,Math.min(100,item.average))}%`}}/><strong>{item.average}%</strong></div><span>{item.label}</span></div>)}</div>:<div className="admin-muted-state">No recorded examination marks are available yet.</div>}
        </article>
        {can('Fees & Finance')&&<article className="admin-dashboard-panel admin-finance-panel"><div className="admin-panel-heading"><div><span className="admin-section-kicker">FINANCIAL OVERVIEW</span><h3>School finances</h3></div><button type="button" className="admin-text-link" onClick={()=>onNavigate('Fees & Finance')}>Open finance <ArrowUpRight size={15}/></button></div><div className="admin-finance-grid"><div><small>FEES EXPECTED</small><strong>UGX {Number(financeSummary.fees_expected||0).toLocaleString('en-UG')}</strong></div><div><small>COLLECTED</small><strong>UGX {Number(financeSummary.fees_collected||0).toLocaleString('en-UG')}</strong></div><div><small>OUTSTANDING</small><strong>UGX {Number(financeSummary.outstanding||0).toLocaleString('en-UG')}</strong></div></div><div className="admin-finance-progress"><span style={{width:`${financeSummary.fees_expected>0?Math.min(100,financeSummary.fees_collected/financeSummary.fees_expected*100):0}%`}}/></div><small className="admin-finance-caption">Collection progress against expected fees</small></article>}
      </div>
      <aside className="admin-dashboard-side">
        <article className="admin-dashboard-panel admin-alert-panel"><div className="admin-panel-heading"><div><span className="admin-section-kicker">ACTION REQUIRED</span><h3>Alerts & approvals</h3></div><span className="admin-alert-count">{alerts.length}</span></div>{alerts.length?alerts.map((alert,index)=><button type="button" className="admin-alert-item" key={index} onClick={()=>alert.section&&onNavigate(alert.section)} disabled={!alert.section}><span className={`admin-alert-symbol ${alert.tone}`}><ShieldCheck size={17}/></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ArrowUpRight size={15}/></button>):<div className="admin-clear-state"><ShieldCheck size={25}/><strong>All clear</strong><span>No pending management alerts were detected.</span></div>}</article>
        <article className="admin-dashboard-panel admin-priority-panel"><div className="admin-panel-heading"><div><span className="admin-section-kicker">MANAGEMENT WORKSPACES</span><h3>Quick access</h3></div></div><div className="admin-priority-list">{priorities.map(item=><button type="button" key={item.section} onClick={()=>onNavigate(item.section)}><span>{item.icon}</span><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowUpRight size={15}/></button>)}</div></article>
        <div className="admin-results-status"><div><span>RESULTS VERIFIED</span><strong>{verified}</strong></div><div><span>AWAITING REVIEW</span><strong>{pending}</strong></div></div>
      </aside>
    </section>
  </div>
}

type DosExamRecord = {id:number;name:string;exam_type?:string;term?:string;year?:number;class_id:number;class_name?:string}
type DosMarkRecord = {id:number;verified:boolean;subject_id:number;score:number}
function DirectorOfStudiesDashboard({token,onNavigate,summary,summaryAvailable,availableSections}:{token:string;onNavigate:(section:string)=>void;summary:DashboardSummary;summaryAvailable:boolean;availableSections:string[]}) {
  const [exams,setExams]=useState<{exam:DosExamRecord;marks:DosMarkRecord[]}[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refreshCount,setRefreshCount]=useState(0)
  const can=(section:string)=>availableSections.includes(section)
  const canViewExaminations=can('Examinations')
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    const load=async()=>{
      try{
        const rows=canViewExaminations?await api<DosExamRecord[]>('exams',token):[]
        const recent=rows.slice(-8).reverse()
        const records=await Promise.all(recent.map(async exam=>({exam,marks:await api<DosMarkRecord[]>(`marks?exam_id=${exam.id}`,token)})))
        if(!cancelled)setExams(records)
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Unable to load academic oversight data.')}
      finally{if(!cancelled)setLoading(false)}
    }
    void load()
    return()=>{cancelled=true}
  },[token,refreshCount,canViewExaminations])
  const allMarks=exams.flatMap(item=>item.marks)
  const pending=allMarks.filter(mark=>!mark.verified).length
  const verified=allMarks.filter(mark=>mark.verified).length
  const examCount=exams.length
  const oversight=[
    {section:'Examinations',eyebrow:'ASSESSMENT GOVERNANCE',title:'Examination & results control',description:'Track examination cycles, review submitted results and verify or return academic records.',action:'Open examination control',icon:<FileText size={20}/>,tone:'violet'},
    {section:'Attendance',eyebrow:'SCHOOL-WIDE MONITORING',title:'Attendance oversight',description:'Review learner attendance records, identify gaps and follow up attendance performance.',action:'Open attendance reports',icon:<CalendarCheck size={20}/>,tone:'green'},
    {section:'Students',eyebrow:'ENROLMENT & CLASS RECORDS',title:'Learner population',description:'Review enrolment, student records and class organisation across the school.',action:'Review student records',icon:<GraduationCap size={20}/>,tone:'amber'},
    {section:'Staff',eyebrow:'ACADEMIC PERSONNEL',title:'Teaching workforce',description:'Register teaching staff and coordinate teacher class and subject assignments.',action:'Manage teaching staff',icon:<Users size={20}/>,tone:'slate'},
    {section:'Timetable',eyebrow:'SCHOOL PROGRAMME',title:'Academic programme',description:'Form the school timetable and organise teaching periods, classes and subject allocations.',action:'Form school timetable',icon:<CalendarDays size={20}/>,tone:'blue'},
    {section:'Leadership & Duty',eyebrow:'SCHOOL GOVERNANCE',title:'Leadership & duty records',description:'Review school leadership structures and duty arrangements where authorised.',action:'Open leadership records',icon:<ShieldCheck size={20}/>,tone:'rose'},
  ].filter(item=>can(item.section))
  return <div className="dos-dashboard">
    <section className="dos-hero">
      <div className="dos-hero-copy"><p className="eyebrow">SCHOOL MANAGEMENT · ACADEMIC ADMINISTRATION</p><h2>Welcome, Director of Studies!</h2><p>Plan. Assign. Monitor. Coordinate teachers, classes, subjects and the school timetable.</p></div>
      <div className="dos-hero-actions"><span className="dos-live-indicator"><span/> Academic oversight</span><button type="button" className="secondary-button" onClick={()=>setRefreshCount(v=>v+1)} disabled={loading}><RefreshCw size={15}/>{loading?'Refreshing...':'Refresh overview'}</button></div>
    </section>
    <section className="dos-responsibility-strip">
      <div className="dos-responsibility-heading"><div><p className="eyebrow">CORE DOS RESPONSIBILITIES</p><h3>Academic staffing & programme coordination</h3><p>Manage the teaching programme from staff registration through class allocation and timetable formation.</p></div><div className="dos-academic-illustration" aria-hidden="true"><span><Users size={24}/></span><span><CalendarDays size={25}/></span><span><BookOpen size={22}/></span></div></div>
      <div className="dos-responsibility-actions">
        {can('Staff')&&<button type="button" className="dos-responsibility-card" onClick={()=>onNavigate('Staff')}><span className="dos-responsibility-icon staff"><UserPlus size={21}/></span><span><strong>Register & manage teachers</strong><small>Maintain teaching staff records and registered teaching subjects.</small></span><ArrowUpRight size={17}/></button>}
        {can('Staff')&&<button type="button" className="dos-responsibility-card" onClick={()=>onNavigate('Staff')}><span className="dos-responsibility-icon assignment"><Users size={21}/></span><span><strong>Assign teachers to classes</strong><small>Coordinate teacher class and subject assignments using registered subjects.</small></span><ArrowUpRight size={17}/></button>}
        {can('Timetable')&&<button type="button" className="dos-responsibility-card" onClick={()=>onNavigate('Timetable')}><span className="dos-responsibility-icon timetable"><CalendarDays size={21}/></span><span><strong>Form the school timetable</strong><small>Build and organise the school teaching timetable and periods.</small></span><ArrowUpRight size={17}/></button>}
      </div>
    </section>
    {summaryAvailable&&<section className="dos-metric-strip">
      <div className="dos-metric"><span className="dos-metric-icon"><BookOpen size={20}/></span><div><small>SCHOOL CLASSES</small><strong>{summary.total_classes}</strong><span>Across the school</span></div></div>
      <div className="dos-metric"><span className="dos-metric-icon"><GraduationCap size={20}/></span><div><small>ACTIVE LEARNERS</small><strong>{summary.active_students.toLocaleString()}</strong><span>Current enrolment</span></div></div>
      <div className="dos-metric"><span className="dos-metric-icon"><CalendarCheck size={20}/></span><div><small>PRESENT TODAY</small><strong>{summary.students_present_today.toLocaleString()}</strong><span>School attendance</span></div></div>
      <div className="dos-metric"><span className="dos-metric-icon"><Users size={20}/></span><div><small>ACTIVE STAFF</small><strong>{summary.active_staff}</strong><span>School personnel</span></div></div>
    </section>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    <div className="dos-management-grid">
      {can('Examinations')&&<section className="panel dos-results-panel">
        <div className="dos-section-heading"><div><p className="eyebrow">RESULTS GOVERNANCE</p><h3>Examination verification overview</h3><p>Submitted academic records across the latest examination cycles.</p></div><span className="count-pill">{examCount} cycles</span></div>
        <div className="dos-result-stats"><div><strong>{loading?'—':pending.toLocaleString()}</strong><span>Awaiting verification</span></div><div><strong>{loading?'—':verified.toLocaleString()}</strong><span>Verified score records</span></div><div><strong>{loading?'—':examCount}</strong><span>Recent examinations</span></div></div>
        {loading?<p className="form-hint">Loading examination records...</p>:exams.length?<div className="dos-exam-list">{exams.slice(0,5).map(({exam,marks})=>{const waiting=marks.filter(mark=>!mark.verified).length;return <div className="dos-exam-row" key={exam.id}><div><strong>{exam.exam_type||exam.name}</strong><small>{[exam.term,exam.year,exam.class_name].filter(Boolean).join(' · ')||exam.name}</small></div><span className={waiting?'dos-status-pending':'dos-status-verified'}>{waiting?waiting+' pending':'Verified'}</span></div>})}</div>:<div className="dos-empty-note"><FileText size={22}/><p>No examination records are available yet.</p></div>}
        <button type="button" className="text-action" onClick={()=>onNavigate('Examinations')}>Open examination management <ArrowUpRight size={14}/></button>
      </section>}
      <section className="panel dos-priority-panel">
        <div className="dos-section-heading"><div><p className="eyebrow">MANAGEMENT PRIORITIES</p><h3>School-wide oversight areas</h3><p>Administrative functions available to your account.</p></div></div>
        {oversight.length?<div className="dos-oversight-list">{oversight.map(item=><button type="button" className="dos-oversight-item" key={item.section} onClick={()=>onNavigate(item.section)}><span className={'dos-workstream-icon '+item.tone}>{item.icon}</span><span><small>{item.eyebrow}</small><strong>{item.title}</strong><em>{item.description}</em></span><ArrowUpRight size={17}/></button>)}</div>:<div className="empty-state"><ShieldCheck size={26}/><p>No oversight areas have been assigned.</p></div>}
      </section>
    </div>
    <section className="dos-footer-note"><ShieldCheck size={17}/><span>This dashboard presents school-level oversight information. It does not display teacher lesson schedules, personal class rosters or teacher result-entry tasks.</span></section>
  </div>
}

function SecretaryDashboard({username: _username,onNavigate,summary,availableSections}:{username:string;onNavigate:(section:string)=>void;summary:DashboardSummary;availableSections:string[]}) {
  const can=(section:string)=>availableSections.includes(section)
  const items=[
    {section:'Students',title:'Student registration & records',detail:'Register learners, update profiles and maintain class records.',icon:<GraduationCap/>},
    {section:'Staff',title:'Staff records',detail:'Maintain teaching and non-teaching staff information.',icon:<Users/>},
    {section:'Parent Access',title:'Parent accounts',detail:'Create parent access and connect accounts to learners.',icon:<Contact/>},
    {section:'Announcements',title:'Announcements',detail:'Prepare and publish school notices and updates.',icon:<Megaphone/>},
    {section:'Reports',title:'School records & reports',detail:'Open the school reports available to your account.',icon:<FolderOpen/>}
  ].filter(item=>can(item.section))
  return <div className="secretary-office-dashboard">
    <section className="secretary-office-hero"><div><span>OFFICE ADMINISTRATION</span><h2>Welcome, Secretary!</h2><p>Keep school records in order. Manage student records, staff information, parent accounts and correspondence.</p></div><div className="secretary-hero-mark"><Contact size={29}/><small>OFFICE WORKSPACE</small></div></section>
    <section className="secretary-stat-grid"><div><GraduationCap/><small>REGISTERED LEARNERS</small><strong>{summary.active_students}</strong><span>Current student records</span></div><div><UserPlus/><small>NEW ADMISSIONS</small><strong>{summary.new_admissions_this_year}</strong><span>Academic year {summary.academic_year}</span></div><div><Users/><small>STAFF RECORDS</small><strong>{summary.active_staff}</strong><span>Teaching & non-teaching</span></div><div><BookOpen/><small>CLASSES & STREAMS</small><strong>{summary.total_classes}</strong><span>School organisation</span></div></section>
    <section className="secretary-office-layout"><div className="secretary-office-main"><div className="secretary-office-heading"><div><span>DAILY OFFICE FUNCTIONS</span><h3>Records & communication</h3></div><small>{items.length} available work areas</small></div><div className="secretary-office-actions">{items.map((item,index)=><button type="button" key={item.section} onClick={()=>onNavigate(item.section)}><span className={`secretary-action-icon tone-${index%4}`}>{item.icon}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowUpRight size={17}/></button>)}</div></div><aside className="secretary-office-side"><span>OFFICE CHECKLIST</span><h3>Keep school records organised</h3><p>Use the authorised work areas to keep learner, staff and parent information current.</p><div className="secretary-check-item"><ShieldCheck/><span><strong>Accurate records</strong><small>Review learner and staff details before saving changes.</small></span></div><div className="secretary-check-item"><Megaphone/><span><strong>Clear communication</strong><small>Share approved notices through Announcements.</small></span></div><div className="secretary-check-item"><Contact/><span><strong>Parent connections</strong><small>Keep parent accounts linked to the correct learners.</small></span></div></aside></section>
  </div>
}

function AttendanceOfficerDashboard({username: _username,onNavigate,summary,availableSections}:{username:string;onNavigate:(section:string)=>void;summary:DashboardSummary;availableSections:string[]}) {
  const can=(section:string)=>availableSections.includes(section)
  const rate=summary.active_students?Math.round(summary.students_present_today/summary.active_students*100):0
  const absent=Math.max(0,summary.active_students-summary.students_present_today)
  const links=[
    {section:'Attendance',title:'Learner attendance register',detail:'Open today’s class registers and review attendance.',icon:<GraduationCap/>},
    {section:'Staff Attendance',title:'Staff check-in & check-out',detail:'Review staff presence and recorded shift times.',icon:<Clock/>},
    {section:'Reports',title:'Attendance reports',detail:'Review attendance summaries and follow-up information.',icon:<FileText/>},
    {section:'Students',title:'Learner directory',detail:'Find learner records for attendance follow-up.',icon:<Users/>}
  ].filter(item=>can(item.section))
  return <div className="attendance-control-dashboard">
    <section className="attendance-control-hero"><div><span>ATTENDANCE OPERATIONS · DAILY CONTROL</span><h2>Welcome, Attendance Officer!</h2><p>Monitor and manage attendance. Review learner presence, staff check-ins and daily follow-up.</p></div><div className="attendance-today-badge"><CalendarCheck size={22}/><strong>{new Date().toLocaleDateString('en-UG',{day:'numeric',month:'short'})}</strong><small>TODAY</small></div></section>
    <section className="attendance-overview-grid"><article className="attendance-rate-card"><div><span>LEARNER ATTENDANCE TODAY</span><h3>{rate}%</h3><p>of active learners marked present</p></div><div className="attendance-rate-track"><span style={{width:`${rate}%`}}/></div><div className="attendance-rate-legend"><span><i/>Present <strong>{summary.students_present_today}</strong></span><span><i/>Not marked present <strong>{absent}</strong></span></div></article><div className="attendance-count-card"><span className="attendance-count-icon green"><CheckCircle2/></span><small>LEARNERS PRESENT</small><strong>{summary.students_present_today}</strong><span>Recorded today</span></div><div className="attendance-count-card"><span className="attendance-count-icon amber"><UserX/></span><small>NOT MARKED PRESENT</small><strong>{absent}</strong><span>Requires register review</span></div><div className="attendance-count-card"><span className="attendance-count-icon blue"><Users/></span><small>ACTIVE LEARNERS</small><strong>{summary.active_students}</strong><span>Current enrolment</span></div></section>
    <section className="attendance-control-lower"><div className="attendance-control-panel"><span>ATTENDANCE WORKSPACES</span><h3>Registers & follow-up</h3><div className="attendance-control-links">{links.map(item=><button type="button" key={item.section} onClick={()=>onNavigate(item.section==='Staff Attendance'?'Attendance':item.section)}><span>{item.icon}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowUpRight size={16}/></button>)}</div></div><aside className="attendance-followup-panel"><span>DAILY FOLLOW-UP</span><h3>Attendance priorities</h3><div><strong>{absent}</strong><p>learners are not currently marked present. Review class registers and confirm outstanding records.</p></div><div><strong>{summary.active_staff}</strong><p>active staff records are available in the school directory for staff attendance review.</p></div></aside></section>
  </div>
}

function RoleSpecificDashboard({username,roleLabel,onNavigate,summary,summaryAvailable,availableSections,financeSummary}:{username:string;roleLabel:string;onNavigate:(section:string)=>void;summary:DashboardSummary;summaryAvailable:boolean;availableSections:string[];financeSummary:FinanceDashboardSummary}) {
  const role=roleLabel.toLowerCase().trim()
  const can=(section:string)=>availableSections.includes(section)
  const open=(section:string)=>onNavigate(section==='Staff Attendance'?'Attendance':section)
  const actions=[
    {section:'Students',title:'Learner records',description:'Review enrolment, student profiles and class records.',icon:<GraduationCap/>,tone:'blue'},
    {section:'Staff',title:'Staff directory',description:'Review teaching and non-teaching staff records.',icon:<Users/>,tone:'purple'},
    {section:'Fees & Finance',title:'Finance oversight',description:'Review collections, balances and school expenditure.',icon:<TrendingUp/>,tone:'green'},
    {section:'Examinations',title:'Academic performance',description:'Monitor examination cycles and results governance.',icon:<FileText/>,tone:'amber'},
    {section:'Attendance',title:'Attendance operations',description:'Review student attendance registers and follow-up.',icon:<CalendarCheck/>,tone:'blue'},
    {section:'Staff Attendance',title:'Staff attendance',description:'Review staff check-in and check-out records.',icon:<Clock/>,tone:'purple'},
    {section:'Timetable',title:'School timetable',description:'Review the school teaching programme.',icon:<CalendarDays/>,tone:'green'},
    {section:'Leadership & Duty',title:'Leadership & duty',description:'Review leadership assignments and duty records.',icon:<ShieldCheck/>,tone:'amber'},
    {section:'Parent Access',title:'Parent access',description:'Manage parent accounts and linked learners.',icon:<Contact/>,tone:'blue'},
    {section:'Announcements',title:'School communication',description:'Publish and review school announcements.',icon:<Megaphone/>,tone:'purple'},
    {section:'Reports',title:'School reports',description:'Open reports available to your account.',icon:<FolderOpen/>,tone:'green'},
  ].filter(item=>can(item.section))
  const isAdministrator=/^(administrator|school administrator|system administrator)$/.test(role)
  const isSecretary=/secretary|office administrator/.test(role)
  const isAttendance=/attendance/.test(role)
  const title=isAdministrator?'Administrator command centre':isSecretary?'Administration & records centre':isAttendance?'Attendance operations centre':'School operations overview'
  const eyebrow=isAdministrator?'SCHOOL ADMINISTRATION · EXECUTIVE OVERSIGHT':isSecretary?'SCHOOL ADMINISTRATION · RECORDS & COMMUNICATION':isAttendance?'SCHOOL OPERATIONS · ATTENDANCE CONTROL':'SCHOOL OPERATIONS'
  const description=isAdministrator?'A school-wide command centre for administration, enrolment, attendance, staffing, academic activity and authorised financial oversight.':isSecretary?'A central workspace for student records, staff administration, parent access and school communication.':isAttendance?'A focused workspace for monitoring daily learner attendance and staff presence.':'A role-focused overview of the school work areas assigned to your account.'
  const priority=isAdministrator?['Students','Staff','Fees & Finance','Examinations','Attendance','Timetable','Leadership & Duty','Announcements','Reports']:isSecretary?['Students','Staff','Parent Access','Announcements','Reports']:['Attendance','Staff Attendance','Students','Reports','Announcements']
  const orderedActions=[...actions].sort((a,b)=>{const ai=priority.indexOf(a.section),bi=priority.indexOf(b.section);return (ai<0?999:ai)-(bi<0?999:bi)})
  return <div className={`role-dashboard command-dashboard ${isAdministrator?'administrator-dashboard':isSecretary?'secretary-dashboard':isAttendance?'attendance-officer-dashboard':'operations-dashboard'}`}>
    <section className="command-hero">
      <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{username} · {roleLabel||'School staff'} · {description}</p></div>
      <span className="command-role-chip"><ShieldCheck size={16}/>{roleLabel||'Staff account'}</span>
    </section>
    {summaryAvailable&&<section className="command-metrics">
      {isAdministrator?<><StatCard title="Active learners" value={summary.active_students} icon={<GraduationCap/>} note="Current enrolment"/><StatCard title="School classes" value={summary.total_classes} icon={<BookOpen/>} note="Classes and streams"/><StatCard title="Present today" value={summary.students_present_today} icon={<CalendarCheck/>} note="Learners marked present"/><StatCard title="Active staff" value={summary.active_staff} icon={<Users/>} note="Teaching and non-teaching"/></>:isSecretary?<><StatCard title="Active learners" value={summary.active_students} icon={<GraduationCap/>} note="Current student records"/><StatCard title="New admissions" value={summary.new_admissions_this_year} icon={<UserPlus/>} note={`Academic year ${summary.academic_year}`}/><StatCard title="Active staff" value={summary.active_staff} icon={<Users/>} note="School staff records"/></>:isAttendance?<><StatCard title="Present today" value={summary.students_present_today} icon={<CalendarCheck/>} note="Learners marked present"/><StatCard title="Active learners" value={summary.active_students} icon={<GraduationCap/>} note="Current enrolment"/><StatCard title="Active staff" value={summary.active_staff} icon={<Users/>} note="Staff in the school directory"/></>:<><StatCard title="Active learners" value={summary.active_students} icon={<GraduationCap/>} note="Current enrolment"/><StatCard title="School classes" value={summary.total_classes} icon={<BookOpen/>} note="Classes and streams"/><StatCard title="Active staff" value={summary.active_staff} icon={<Users/>} note="School staff"/></>}</section>}
    {isAdministrator&&can('Fees & Finance')&&<section className="command-finance-strip"><div><small>FEES COLLECTED</small><strong>UGX {Number(financeSummary.fees_collected||0).toLocaleString('en-UG')}</strong></div><div><small>OUTSTANDING FEES</small><strong>UGX {Number(financeSummary.outstanding||0).toLocaleString('en-UG')}</strong></div><div><small>EXPECTED FEES</small><strong>UGX {Number(financeSummary.fees_expected||0).toLocaleString('en-UG')}</strong></div><button type="button" className="secondary-button" onClick={()=>open('Fees & Finance')}>Open finance oversight <ArrowUpRight size={15}/></button></section>}
    <section className="command-content">
      <div className="command-main-panel">
        <div className="panel-heading"><div><h3>{isAdministrator?'School-wide priorities':isSecretary?'Administration desk':isAttendance?'Daily attendance control':'Your school work areas'}</h3><p>{isAdministrator?'Management areas available under your current permissions.':isSecretary?'Choose an authorised records or communication function.':isAttendance?'Open the relevant register to review and update attendance.':'Open an authorised area to continue.'}</p></div><span className="count-pill">{orderedActions.length} authorised areas</span></div>
        {orderedActions.length>0?<div className="command-action-grid">{orderedActions.map(item=><button type="button" className="command-action-card" key={item.section} onClick={()=>open(item.section)}><span className={`command-action-icon ${item.tone}`}>{item.icon}</span><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowUpRight size={17}/></button>)}</div>:<div className="empty-state"><Briefcase size={28}/><p>No work areas have been assigned to this account.</p><small>Contact the school administrator if access is required.</small></div>}
      </div>
      <aside className="command-side-panel">
        <div className="panel-heading"><div><h3>{isAdministrator?'Administrator brief':isSecretary?'Office workflow':isAttendance?'Attendance workflow':'Account information'}</h3><p>{isAdministrator?'Your school-wide administration snapshot.':isSecretary?'Core administrative responsibilities.':isAttendance?'Your daily attendance responsibilities.':'Your account access.'}</p></div></div>
        {isAdministrator?<><div className="command-brief-item"><strong>School administration</strong><span>Coordinate enrolment, staffing and academic activity from one administrative view.</span></div><div className="command-brief-item"><strong>Operational control</strong><span>Use only the work areas enabled by your administrator.</span></div><div className="command-brief-item"><strong>Financial visibility</strong><span>{can('Fees & Finance')?'Financial summary is available above.':'Finance information is not assigned to this account.'}</span></div></>:isSecretary?<><div className="command-brief-item"><strong>Student records</strong><span>Maintain authorised learner information and admission records.</span></div><div className="command-brief-item"><strong>Parent communication</strong><span>Use Parent Access and Announcements when those permissions are enabled.</span></div><div className="command-brief-item"><strong>Staff administration</strong><span>Keep staff directory information organised within your assigned access.</span></div></>:isAttendance?<><div className="command-brief-item"><strong>Learner register</strong><span>Open Attendance to review the daily student register.</span></div><div className="command-brief-item"><strong>Staff presence</strong><span>{can('Staff Attendance')?'Staff attendance records are available to your account.':'Staff attendance access has not been assigned.'}</span></div><div className="command-brief-item"><strong>Follow-up</strong><span>Use authorised student and report areas for attendance follow-up.</span></div></>:<div className="command-brief-item"><strong>Access control</strong><span>Your dashboard shortcuts follow your assigned permissions.</span></div>}
      </aside>
    </section>
  </div>
}

function FinanceAccountDashboard({token,username: _username,onNavigate}:{token:string;username:string;onNavigate:(section:string,tab?:'overview'|'payments'|'balances')=>void}) {
  const [summary,setSummary]=useState<{fees_expected:number;fees_collected:number;outstanding:number;salary_expenses?:number;other_expenses?:number;total_expenses?:number;net_cash_position?:number}|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [refreshCount,setRefreshCount]=useState(0)
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    api<any>('finance/summary',token).then(result=>{if(!cancelled)setSummary(result)})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Unable to load finance records.')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return ()=>{cancelled=true}
  },[token,refreshCount])
  const money=(value:number|undefined)=>'UGX '+Number(value||0).toLocaleString('en-UG')
  return <div className="role-dashboard finance-account-dashboard">
    <section className="dashboard-role-heading"><div><p className="eyebrow">FINANCE WORKSPACE</p><h2>Welcome, Bursar!</h2><p>Track and manage school finances. Collections, outstanding fees and school expenditure.</p></div><div className="dashboard-heading-actions"><span className="count-pill">Finance account</span><button type="button" className="secondary-button" onClick={()=>setRefreshCount(value=>value+1)} disabled={loading}>{loading?'Refreshing...':'Refresh data'}</button></div></section>
    {loading&&<p className="form-hint">Loading finance summary...</p>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {summary&&<section className="role-dashboard-stats">
      <StatCard title="Fees collected" value={money(summary.fees_collected)} icon={<TrendingUp/>} note="Payments received" />
      <StatCard title="Outstanding fees" value={money(summary.outstanding)} icon={<FileText/>} note="Balances still due" />
      <StatCard title="Expected fees" value={money(summary.fees_expected)} icon={<BookOpen/>} note="Total charges raised" />
      <StatCard title="Total expenses" value={money(summary.total_expenses)} icon={<Users/>} note="Salary and other expenses" />
    </section>}
    <section className="role-dashboard-actions">
      <button type="button" className="quick-action" onClick={()=>onNavigate('Fees & Finance','overview')}><span className="quick-icon blue"><FileText/></span><span><strong>Finance workspace</strong><small>Open payments, balances, expenses and fee structures.</small></span><ArrowUpRight size={17}/></button>
      <button type="button" className="quick-action" onClick={()=>onNavigate('Fees & Finance','balances')}><span className="quick-icon purple"><TrendingUp/></span><span><strong>Outstanding fee follow-up</strong><small>Review student balances and follow up collections.</small></span><ArrowUpRight size={17}/></button>
    </section>
    {!loading&&!summary&&!error&&<p className="empty-state">No finance summary is available yet.</p>}
  </div>
}

function validateRequiredFields(event: React.FormEvent<HTMLDivElement>) {
  const form = event.target as HTMLFormElement
  if (form.tagName !== 'FORM') return
  const requiredFields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[required]'))
  const emptyTextField = requiredFields.find(field => {
    const type = field instanceof HTMLInputElement ? field.type : ''
    return ['text', 'email', 'tel', 'url', 'search', 'password'].includes(type) && !field.value.trim()
  })
  if (emptyTextField) {
    event.preventDefault()
    emptyTextField.setCustomValidity('Please complete this required field before saving.')
    emptyTextField.reportValidity()
    emptyTextField.setCustomValidity('')
  }
}


type FirstSetupStatus = {
  loading: boolean
  setup_completed: boolean
  activated: boolean
  installation_id: string
  school_id?: string
  identity_locked: boolean
  error: string
}

function FirstTimeSetupWizard({status,onStatusChange}:{status:FirstSetupStatus;onStatusChange:(next:FirstSetupStatus)=>void}) {
  const [license,setLicense]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const draftKey=`schoolbridge-first-setup-draft:${status.installation_id}`
  const [school,setSchool]=useState(()=>{
    const defaults={
      school_name:'', school_type:'Secondary', country:'', school_structure:'Day',
      address:'', phone:'', email:'', motto:'', report_logo:'', house_names:'',
      admin_username:'', admin_email:'', admin_password:'',
    }
    let draft:Record<string,unknown>={}
    try {
      const saved=typeof window!=='undefined'?window.sessionStorage.getItem(draftKey):null
      const parsed=saved?JSON.parse(saved):null
      if(parsed&&typeof parsed==='object')draft=parsed
    } catch { /* Browser storage may be unavailable; setup can continue without a saved draft. */ }
    return {
      ...defaults,
      school_name:typeof draft.school_name==='string'?draft.school_name:defaults.school_name,
      school_type:typeof draft.school_type==='string'?draft.school_type:defaults.school_type,
      country:typeof draft.country==='string'?draft.country:defaults.country,
      school_structure:typeof draft.school_structure==='string'?draft.school_structure:defaults.school_structure,
      address:typeof draft.address==='string'?draft.address:defaults.address,
      phone:typeof draft.phone==='string'?draft.phone:defaults.phone,
      email:typeof draft.email==='string'?draft.email:defaults.email,
      motto:typeof draft.motto==='string'?draft.motto:defaults.motto,
      house_names:typeof draft.house_names==='string'?draft.house_names:defaults.house_names,
    }
  })
  useEffect(()=>{
    // Persist only non-secret school profile fields for this browser tab/session.
    // Never persist the activation code, logo data, administrator identity or password.
    const draft={
      school_name:school.school_name,school_type:school.school_type,country:school.country,
      school_structure:school.school_structure,address:school.address,phone:school.phone,
      email:school.email,motto:school.motto,house_names:school.house_names,
    }
    try { window.sessionStorage.setItem(draftKey,JSON.stringify(draft)) }
    catch { /* Setup remains usable if browser storage is disabled or full. */ }
  },[draftKey,school])
  function handleSchoolLogo(event:React.ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0]
    if(!file)return
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){
      setError('Choose a PNG, JPEG or WebP school logo.')
      event.target.value=''
      return
    }
    if(file.size>1_400_000){
      setError('The school logo must be smaller than 1.4 MB.')
      event.target.value=''
      return
    }
    const reader=new FileReader()
    reader.onload=()=>{
      if(typeof reader.result==='string'){
        setSchool(current=>({...current,report_logo:reader.result as string}))
        setError('')
      }
    }
    reader.onerror=()=>setError('The school logo could not be read. Try another image.')
    reader.readAsDataURL(file)
  }
  async function activate(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const response=await fetchSchoolBridge(`${API_BASE_URL}/api/setup/activate`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({license,school_id:status.school_id||undefined}),
      })
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.detail||'Installation activation failed.')
      try { localStorage.setItem('schoolbridge-installation-id', status.installation_id) } catch { /* Ignore unavailable browser storage. */ }
      onStatusChange({...status,activated:true,error:''})
    } catch(e) { setError(e instanceof Error?e.message:'Installation activation failed.') }
    finally { setBusy(false) }
  }
  async function completeSetup(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const response=await fetchSchoolBridge(`${API_BASE_URL}/api/setup/complete`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...school,school_id:status.school_id||undefined,activation_license:license}),
      })
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.detail||'School setup could not be completed.')
      try {
        localStorage.setItem('schoolbridge-installation-id', status.installation_id)
        window.sessionStorage.removeItem(draftKey)
      } catch { /* Ignore unavailable browser storage. */ }
      onStatusChange({...status,setup_completed:true,activated:true,identity_locked:true,error:''})
      setSchool({...school,admin_password:''})
      setLicense('')
    } catch(e) { setError(e instanceof Error?e.message:'School setup could not be completed.') }
    finally { setBusy(false) }
  }
  return <main className="login-page first-setup-page">
    <section className="login-card first-setup-card">
      <div className="brand-mark"><GraduationCap size={30}/></div>
      <div className="brand-name">School<span>Bridge</span></div>
      <p className="login-subtitle">Secure first-time school installation</p>
      <div className="first-setup-progress"><span className={status.activated?'complete':''}>1. Owner activation</span><span className={status.activated?'active':''}>2. School setup</span></div>
      {!status.activated ? <>
        <h1>Activate this installation</h1>
        <p className="muted">This installation must be authorised by the SchoolBridge owner before school records or administrator accounts can be created.</p>
        <div className="installation-id-panel"><small>UNIQUE INSTALLATION ID</small><strong>{status.installation_id}</strong><button type="button" className="secondary-button" onClick={()=>void navigator.clipboard?.writeText(status.installation_id)}>Copy installation ID</button></div>
        <form onSubmit={activate}>
          <label htmlFor="schoolbridge-license">CHRISTIAN Owner Key activation code</label>
          <textarea id="schoolbridge-license" value={license} onChange={e=>setLicense(e.target.value)} required rows={4} placeholder="Paste the CHRISTIAN activation code here"/>
          {error&&<p className="error" role="alert">{error}</p>}
          <button className="primary-button login-button" disabled={busy||license.trim().length<20}>{busy?'Verifying license...':'Activate installation'}</button>
        </form>
      </> : <>
        <h1>Set up your school</h1>
        <p className="muted">Enter the school's official details and create its first administrator account. The original school identity will be protected after setup.</p>
        <p className="form-hint">If this page is refreshed, school identity and contact fields are restored in this browser tab. The activation code, logo file and administrator credentials are not saved; keep the code available and re-enter those details if needed.</p>
        <form onSubmit={completeSetup}>
          <div className="first-setup-section"><h3>Owner authorisation</h3>
            <label htmlFor="schoolbridge-license-confirm">Confirm CHRISTIAN Owner Key activation code</label>
            <textarea id="schoolbridge-license-confirm" value={license} onChange={e=>setLicense(e.target.value)} required rows={3} placeholder="Paste the same CHRISTIAN activation code used to activate this installation"/>
            <p className="form-hint">The same CHRISTIAN activation code is required to create the first administrator. Your private owner key is never entered or stored on this school setup page.</p>
          </div>
          <div className="first-setup-section"><h3>School identity</h3>
            <label>Official school name *<input required minLength={2} maxLength={160} value={school.school_name} onChange={e=>setSchool({...school,school_name:e.target.value})}/></label>
            <div className="first-setup-grid">
              <label>School type *<select value={school.school_type} onChange={e=>setSchool({...school,school_type:e.target.value})}><option>Primary</option><option>Secondary</option><option>Combined</option></select></label>
              <label>School structure *<select value={school.school_structure} onChange={e=>setSchool({...school,school_structure:e.target.value})}><option>Day</option><option>Boarding</option><option>Both</option></select></label>
            </div>
            <label>Country *<input required value={school.country} onChange={e=>setSchool({...school,country:e.target.value})} placeholder="e.g. Uganda"/></label>
          </div>
          <div className="first-setup-section"><h3>Contact and location</h3>
            <label>Physical address<input value={school.address} onChange={e=>setSchool({...school,address:e.target.value})}/></label>
            <div className="first-setup-grid">
              <label>School phone<input type="tel" value={school.phone} onChange={e=>setSchool({...school,phone:e.target.value})}/></label>
              <label>School email<input type="email" value={school.email} onChange={e=>setSchool({...school,email:e.target.value})}/></label>
            </div>
            <label>School motto<input value={school.motto} onChange={e=>setSchool({...school,motto:e.target.value})}/></label>
          </div>
          <div className="first-setup-section"><h3>School branding</h3>
            <label>School logo (PNG, JPEG or WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSchoolLogo}/></label>
            {school.report_logo&&<img className="first-setup-logo-preview" src={school.report_logo} alt="School logo preview"/>}
            <label>House names (one per line)<textarea rows={3} value={school.house_names} onChange={e=>setSchool({...school,house_names:e.target.value})} placeholder="Enter house names, one per line"/></label>
          </div>
          <div className="first-setup-section"><h3>First administrator</h3>
            <label>Administrator username *<input required minLength={3} maxLength={80} autoComplete="username" value={school.admin_username} onChange={e=>setSchool({...school,admin_username:e.target.value})}/></label>
            <label>Administrator email *<input required type="email" autoComplete="email" value={school.admin_email} onChange={e=>setSchool({...school,admin_email:e.target.value})}/></label>
            <label>Private password *<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={school.admin_password} onChange={e=>setSchool({...school,admin_password:e.target.value})}/></label>
            <p className="form-hint">Use at least 12 characters. SchoolBridge stores only a secure password hash.</p>
          </div>
          <div className="first-setup-confirmation">
            <strong>Final confirmation</strong>
            <p>The official school name, school type, country and school structure will be protected after setup. Any exceptional correction will require a separate owner-signed authorisation.</p>
            <label><input type="checkbox" required/> I have checked these official school details and confirm they are correct.</label>
          </div>
          {error&&<p className="error" role="alert">{error}</p>}
          <button className="primary-button login-button" disabled={busy}>{busy?'Saving school setup...':'Complete school setup'}</button>
        </form>
      </>}
      <p className="login-foot"><ShieldCheck size={15}/> Existing school installations are protected from this first-time setup process.</p>
    </section>
  </main>
}

function readOfflineLoginIndex(expectedSchoolId = ''): { userId:number; deviceId:string; username:string; installationId:string; schoolId?:string } | null {
  try {
    const raw = localStorage.getItem('schoolbridge-offline-login-index')
    if (!raw) return null
    const index = JSON.parse(raw)
    const installedIdentity = localStorage.getItem('schoolbridge-installation-id')
    if (!Number.isSafeInteger(index?.userId) || index.userId < 1 ||
        typeof index.deviceId !== 'string' || !index.deviceId ||
        typeof index.username !== 'string' || !index.username ||
        typeof index.installationId !== 'string' || !index.installationId ||
        (index.schoolId !== undefined && (typeof index.schoolId !== 'string' || !index.schoolId)) ||
        (expectedSchoolId && index.schoolId !== expectedSchoolId) ||
        !installedIdentity || index.installationId !== installedIdentity) return null
    return index
  } catch {
    return null
  }
}

type OfflineWorkspaceSnapshot = {
  version:number; userId:number; deviceId:string; username:string; schoolId?:string; schoolName?:string; installationId:string; role:string; role_label?:string;
  permissions?:Record<string,string[]>; downloadedAt:number; expiresAt:number;
  students:any[]; classes:any[]; attendance:any[]; exams:any[]; marks:any[];
  charges:any[]; payments:any[]; class_fees:any[];
}
function OfflineWorkspace({snapshot,onExit}:{snapshot:OfflineWorkspaceSnapshot;onExit:()=>void}) {
  const [section,setSection]=useState<'students'|'classes'|'attendance'|'exams'|'marks'|'finance'>('students')
  const labels:{key:typeof section;label:string;rows:any[]}[]=[
    {key:'students',label:'Students',rows:snapshot.students||[]},{key:'classes',label:'Classes',rows:snapshot.classes||[]},
    {key:'attendance',label:'Attendance',rows:snapshot.attendance||[]},{key:'exams',label:'Examinations',rows:snapshot.exams||[]},
    {key:'marks',label:'Results',rows:snapshot.marks||[]},
    {key:'finance',label:'Finance',rows:[...(snapshot.charges||[]),...(snapshot.payments||[]),...(snapshot.class_fees||[])]},
  ]
  const current=labels.find(item=>item.key===section)!
  const fields=section==='students'?['name','first_name','last_name','admission_number','class_name','section']:
    section==='classes'?['name','section']:section==='attendance'?['student_name','date','status','class_name']:
    section==='exams'?['name','term','year','class_name']:section==='marks'?['student_name','subject_name','score','grade','verified']:
    ['student_name','description','amount','date','status']
  const value=(row:any,key:string)=>{const v=row?.[key];return v===null||v===undefined?'—':typeof v==='object'?JSON.stringify(v):String(v)}
  return <main className="login-page"><section className="login-card" style={{width:'min(1100px,96vw)',maxWidth:1100,textAlign:'left'}}>
    <div className="brand-name">School<span>Bridge</span></div><h1>Offline workspace</h1>
    <p className="muted">Signed in locally as {snapshot.username} · {snapshot.role_label||snapshot.role}</p>
    <p className="form-hint">Read-only copy from {new Date(snapshot.downloadedAt).toLocaleString()}. Expires {new Date(snapshot.expiresAt).toLocaleString()}. Reconnect to validate access and synchronise changes.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,margin:'16px 0'}}>{labels.map(item=><button key={item.key} type="button" className={section===item.key?'primary-button':'secondary-button'} onClick={()=>setSection(item.key)}>{item.label} ({item.rows.length})</button>)}</div>
    <div className="table-wrap"><table><thead><tr>{fields.map(field=><th key={field}>{field.replace(/_/g,' ')}</th>)}</tr></thead><tbody>
      {current.rows.slice(0,500).map((row:any,index:number)=><tr key={row.id??index}>{fields.map(field=><td key={field}>{value(row,field)}</td>)}</tr>)}
      {!current.rows.length&&<tr><td colSpan={fields.length}>No {current.label.toLowerCase()} were included in this offline copy.</td></tr>}
    </tbody></table></div>
    {current.rows.length>500&&<p className="form-hint">Showing the first 500 records. Reconnect for the complete school data.</p>}
    <p className="form-hint">Offline mode is read-only. Creating or changing school records requires a verified connection.</p>
    <button type="button" className="secondary-button" onClick={onExit}>Return to sign in</button>
  </section></main>
}

function getSelectedSchoolId(): string {
  if (typeof window === 'undefined') return ''
  const fromUrl = new URLSearchParams(window.location.search).get('school')
  if (fromUrl) return fromUrl
  try { return localStorage.getItem('schoolbridge-selected-school-id') || '' }
  catch { return '' }
}

function App() {
  const selectedSchoolId = getSelectedSchoolId()
  const [token, setToken] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [offlineWorkspace, setOfflineWorkspace] = useState<OfflineWorkspaceSnapshot | null>(null)
  const [showRecovery, setShowRecovery] = useState(false)
  const [showRegistration, setShowRegistration] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState('Overview')
  const [overviewShortcuts, setOverviewShortcuts] = useState<string[]>([])
  const [serverConnection, setServerConnection] = useState<'checking' | 'connected' | 'disconnected'>('checking')
  const [syncDeviceRevoked, setSyncDeviceRevoked] = useState(false)
  const [setupStatus,setSetupStatus] = useState<FirstSetupStatus>({loading:true,setup_completed:false,activated:false,installation_id:'',school_id:selectedSchoolId,identity_locked:false,error:''})
  const [qrSchoolName,setQrSchoolName] = useState('')
  const [qrSchoolError,setQrSchoolError] = useState('')
  useEffect(() => {
    const querySchoolId = new URLSearchParams(window.location.search).get('school')
    if (!querySchoolId) return
    try { localStorage.setItem('schoolbridge-selected-school-id', querySchoolId) }
    catch { /* The QR query remains available for this browser session. */ }
  }, [selectedSchoolId])
  useEffect(() => {
    let cancelled = false
    loadStoredSessionToken().then(savedToken => {
      if (!cancelled && savedToken) setToken(savedToken)
    }).catch(error => {
      if (!cancelled) setLoginError(error instanceof Error ? error.message : 'Unable to access secure session storage.')
    })
    return () => { cancelled = true }
  }, [])
  useEffect(()=>{
    let cancelled=false
    fetchSchoolBridge(API_BASE_URL + '/api/setup/status' + (selectedSchoolId ? '?school=' + encodeURIComponent(selectedSchoolId) : '')).then(async response=>{
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.detail||'Unable to check installation setup.')
      if(!cancelled) {
        try {
          if(result.setup_completed && result.activated && result.installation_id) localStorage.setItem('schoolbridge-installation-id', result.installation_id)
          else localStorage.removeItem('schoolbridge-installation-id')
        } catch { /* Ignore unavailable browser storage. */ }
        setSetupStatus({loading:false,setup_completed:Boolean(result.setup_completed),activated:Boolean(result.activated),installation_id:result.installation_id||'',school_id:result.school_id||'',identity_locked:Boolean(result.identity_locked),error:''})
      }
    }).catch(e=>{if(!cancelled)setSetupStatus({loading:false,setup_completed:false,activated:false,installation_id:'',school_id:selectedSchoolId,identity_locked:false,error:e instanceof Error?e.message:'Unable to check installation setup.'})})
    return ()=>{cancelled=true}
  },[selectedSchoolId])
  useEffect(() => {
    const expectedSchoolId = selectedSchoolId
    if (!expectedSchoolId || setupStatus.loading) return
    if (setupStatus.error && !navigator.onLine) {
      const cachedName = localStorage.getItem('schoolbridge-school-name-' + expectedSchoolId) || ''
      if (cachedName) { setQrSchoolName(cachedName); setQrSchoolError('') }
      else setQrSchoolError('This school identity has not been saved on this device. Reconnect once to verify the school QR code.')
      return
    }
    if (!setupStatus.setup_completed || expectedSchoolId !== setupStatus.school_id) {
      setQrSchoolError('This QR code belongs to a different SchoolBridge installation. Ask your school for its current access QR code.')
      return
    }
    let cancelled = false
    fetchSchoolBridge(API_BASE_URL + '/api/public/school?school=' + encodeURIComponent(expectedSchoolId), { cache: 'no-store' })
      .then(async response => {
        const identity = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(identity.detail || 'Unable to verify the school identity.')
        if (identity.school_id !== expectedSchoolId) throw new Error('The QR code does not match this school.')
        try { localStorage.setItem('schoolbridge-school-name-' + expectedSchoolId, identity.school_name) } catch { /* The current verified identity remains usable for this session. */ }
        if (!cancelled) setQrSchoolName(identity.school_name)
      })
      .catch(error => { if (!cancelled) setQrSchoolError(error instanceof Error ? error.message : 'Unable to verify the school identity.') })
    return () => { cancelled = true }
  }, [selectedSchoolId, setupStatus.loading, setupStatus.setup_completed, setupStatus.school_id])

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)
  const syncPollInFlight = useRef(false)
  useEffect(() => {
    if (!user) { setOverviewShortcuts([]); return }
    try {
      const saved = localStorage.getItem(`schoolbridge-overview-shortcuts-${user.id}`)
      setOverviewShortcuts(saved ? (JSON.parse(saved) as string[]) : [])
    } catch { setOverviewShortcuts([]) }
  }, [user?.id])
  function addOverviewShortcut(section: string) {
    if (section === 'Overview' || section === 'Settings') return
    setOverviewShortcuts(current => {
      if (current.includes(section)) return current
      const next = [...current, section]
      if (user) localStorage.setItem(`schoolbridge-overview-shortcuts-${user.id}`, JSON.stringify(next))
      return next
    })
  }
  function removeOverviewShortcut(section: string) {
    setOverviewShortcuts(current => {
      const next = current.filter(item => item !== section)
      if (user) localStorage.setItem(`schoolbridge-overview-shortcuts-${user.id}`, JSON.stringify(next))
      return next
    })
  }
  function beginShortcutHold(section: string) {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTriggered.current = false
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      addOverviewShortcut(section)
    }, 5000)
  }
  function cancelShortcutHold() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }
  const [financeTabRequest, setFinanceTabRequest] = useState<'overview' | 'payments' | 'balances'>('overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [settingsSection, setSettingsSection] = useState('home')
  const [students, setStudents] = useState<RecordItem[]>([])
  const [studentTotal, setStudentTotal] = useState(0)
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({ active_students: 0, new_admissions_this_year: 0, students_present_today: 0, active_staff: 0, total_classes: 0, academic_year: new Date().getFullYear() })
  const [financeDashboard, setFinanceDashboard] = useState<FinanceDashboardSummary>({ fees_expected: 0, fees_collected: 0, outstanding: 0 })
  const [studentPage, setStudentPage] = useState(1)
  const [studentClassFilter, setStudentClassFilter] = useState('')
  const [studentArchive, setStudentArchive] = useState(false)
  const [classes, setClasses] = useState<RecordItem[]>([])
  const [dataError, setDataError] = useState('')
  const [search, setSearch] = useState('')
  const [showStudentForm, setShowStudentForm] = useState(false)
  const [showClassForm, setShowClassForm] = useState(false)
  const [classForm, setClassForm] = useState({ name: '', section: '' })
  const [classError, setClassError] = useState('')
  const [classSuccess, setClassSuccess] = useState('')
  const [savingClass, setSavingClass] = useState(false)
  const [savingStudent, setSavingStudent] = useState(false)
  const [studentProfile, setStudentProfile] = useState<any>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [studentError, setStudentError] = useState('')
  const [studentSuccess, setStudentSuccess] = useState('')
  const [studentForm, setStudentForm] = useState({
    first_name: '', middle_name: '', last_name: '', full_name: '', a_level_stream: '', generate_admission_number: true, gender: '', date_of_birth: '', class_id: '',
    religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', guardian2_name: '', guardian2_relationship: '', guardian2_phone: '', study_mode: 'Day', house: '', previous_school: '',
    admission_date: new Date().toISOString().slice(0, 10), fee_amount: '', academic_level: '', combination: '', optional_subjects: '', subsidiary_subjects: '',
  })
  const [mobileMenu, setMobileMenu] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [admissionSettings, setAdmissionSettings] = useState<AdmissionSettings>({
    admission_prefix: 'SB', include_year: true, admission_separator: '-',
    admission_padding: 4, next_admission_number: 1,
  })
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  const [schoolConfig, setSchoolConfig] = useState<any>({ school_type: 'Primary', a_level_combinations: '', o_level_optional_subjects: '', a_level_subsidiary_subjects: '' })

  useEffect(()=>{if(token && user?.role==='admin')api<any>('settings/school-profile',token).then(setSchoolConfig).catch(()=>{})},[token,user?.role])

  async function loadSchoolData(authToken: string, profile: User | null = user) {
    setDataError('')
    const isAdmin = profile?.role === 'admin'
    const allowed = (section:string) => isAdmin || (profile?.permissions?.[section] || []).includes('view')
    const canLoadStudents = allowed('Students')
    const canLoadClasses = canLoadStudents || allowed('Timetable') || allowed('Examinations') || allowed('Attendance')
    const jobs: Promise<any>[] = [
      canLoadStudents ? api<StudentPage>('students/search?page=1&page_size=5', authToken) : Promise.resolve(null),
      canLoadClasses ? api<RecordItem[]>('classes', authToken) : Promise.resolve(null),
      isAdmin ? api<AdmissionSettings>('settings/admission-number', authToken) : Promise.resolve(null),
      allowed('Overview') ? api<DashboardSummary>(`dashboard/summary?attendance_date=${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`, authToken) : Promise.resolve(null),
      allowed('Fees & Finance') ? api<FinanceDashboardSummary>('finance/summary', authToken) : Promise.resolve(null),
    ]
    try {
      const [studentData, classData, admissionData, summaryData, financeSummaryData] = await Promise.all(jobs)
      if(studentData){setStudents(studentData.items);setStudentTotal(studentData.total);setStudentPage(1)}
      if(classData)setClasses(classData)
      if(admissionData)setAdmissionSettings(admissionData)
      if(summaryData)setDashboardSummary(summaryData)
      if(financeSummaryData)setFinanceDashboard(financeSummaryData)
    } catch {
      setDataError('Some records could not be loaded. Check your assigned permissions or contact the administrator.')
    }
  }

  async function refreshWorkspace() {
    if (isRefreshing) return
    setIsRefreshing(true)
    setDataError('')
    setRefreshKey(value => value + 1)
    try {
      await loadSchoolData(token)
      if (active === 'Students') await loadStudentPage(1, search)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function registerClass(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingClass(true)
    setClassError('')
    setClassSuccess('')
    try {
      await api<RecordItem>('classes', token, {
        method: 'POST',
        body: JSON.stringify({
          name: classForm.name.trim(),
          section: classForm.section.trim(),
        }),
      })
      setClassForm({ name: '', section: '' })
      setShowClassForm(false)
      setClassSuccess('Class created successfully. The class list has been refreshed.')
      await loadSchoolData(token)
    } catch (error) {
      setClassError(error instanceof Error ? error.message : 'Unable to create class.')
    } finally {
      setSavingClass(false)
    }
  }

  const [deletingClassId, setDeletingClassId] = useState<number | null>(null)

  async function deleteClass(item: RecordItem) {
    if (!window.confirm(`Remove class "${item.name}${item.section ? ' — ' + item.section : ''}"? This is allowed only when no students, fee records or teacher assignments are linked to it.`)) return
    setDeletingClassId(item.id)
    setClassError('')
    setClassSuccess('')
    try {
      await api(`classes/${item.id}`, token, { method: 'DELETE' })
      setClassSuccess('Class removed successfully.')
      await loadSchoolData(token)
    } catch (error) {
      setClassError(error instanceof Error ? error.message : 'Unable to remove class.')
    } finally {
      setDeletingClassId(null)
    }
  }

  async function registerStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fullName = studentForm.full_name.trim()
    const missingStudentFields = [
      !fullName || fullName.split(/\s+/).length < 2 ? 'Full name (first and last name)' : '',
      !studentForm.class_id ? 'Class' : '',
      !studentForm.gender ? 'Gender' : '',
      !studentForm.guardian_name.trim() ? 'Parent / guardian name' : '',
      schoolConfig.school_type !== 'Primary' && selectedAcademicLevel === 'A-Level' && !studentForm.a_level_stream ? 'A-Level stream' : '',
      schoolConfig.school_type !== 'Primary' && selectedAcademicLevel === 'A-Level' && !studentForm.combination ? 'A-Level combination' : '',
    ].filter(Boolean)
    if (missingStudentFields.length) {
      setStudentError('Cannot register student. Complete: ' + missingStudentFields.join(', ') + '.')
      return
    }
    setSavingStudent(true)
    setStudentError('')
    setStudentSuccess('')
    try {
      const createdStudent = await api<RecordItem>('students', token, {
        method: 'POST',
        body: JSON.stringify({
          generate_admission_number: studentForm.generate_admission_number,
          first_name: studentForm.full_name.trim().split(/\s+/)[0] || '',
          middle_name: null,
          last_name: studentForm.full_name.trim().split(/\s+/).slice(1).join(' '),
          religion: studentForm.religion || null,
          nationality: studentForm.nationality.trim() || null,
          phone: studentForm.phone.trim() || null,
          address: studentForm.address.trim() || null,
          guardian_name: studentForm.guardian_name.trim() || null,
          guardian_relationship: studentForm.guardian_relationship || null,
          guardian_phone: studentForm.guardian_phone.trim() || null,
          guardian2_name: studentForm.guardian2_name.trim() || null,
          guardian2_relationship: studentForm.guardian2_relationship || null,
          guardian2_phone: studentForm.guardian2_phone.trim() || null,
          study_mode: studentForm.study_mode,
          house: studentForm.house || null,
          previous_school: studentForm.previous_school.trim() || null,
          admission_date: studentForm.admission_date || null,
          gender: studentForm.gender || null,
          date_of_birth: studentForm.date_of_birth || null,
          class_id: Number(studentForm.class_id),
          fee_amount: studentForm.fee_amount === '' ? null : Number(studentForm.fee_amount),
          academic_level: schoolConfig.school_type!=='Primary' ? selectedAcademicLevel || null : null,
          combination: selectedAcademicLevel==='A-Level' && studentForm.a_level_stream && studentForm.combination ? `${studentForm.a_level_stream} — ${studentForm.combination}` : null,
          optional_subjects: selectedAcademicLevel==='O-Level' ? studentForm.optional_subjects || null : null,
          subsidiary_subjects: selectedAcademicLevel==='A-Level' ? studentForm.subsidiary_subjects || null : null,
        }),
      })
      setStudentForm({ first_name: '', middle_name: '', last_name: '', full_name: '', a_level_stream: '', generate_admission_number: true, gender: '', date_of_birth: '', class_id: '', religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', guardian2_name: '', guardian2_relationship: '', guardian2_phone: '', study_mode: 'Day', house: '', previous_school: '', admission_date: new Date().toISOString().slice(0, 10), fee_amount: '', academic_level: '', combination: '', optional_subjects: '', subsidiary_subjects: '' })
      setShowStudentForm(false)
      setStudentSuccess(createdStudent.admission_number ? `Student registered successfully. Admission number: ${createdStudent.admission_number}` : 'Student registered successfully. This school does not use admission numbers for this record.')
      await loadSchoolData(token)
    } catch (error) {
      setStudentError(error instanceof Error ? error.message : 'Unable to register student.')
    } finally {
      setSavingStudent(false)
    }
  }


  async function saveAdmissionSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prefix=admissionSettings.admission_prefix.trim()
    const sequence=Number(admissionSettings.next_admission_number)
    if(!prefix){setSettingsError('Enter a school prefix before saving.');return}
    if(!Number.isInteger(sequence)||sequence<1){setSettingsError('The next sequence number must be a whole number greater than zero.');return}
    setSavingSettings(true)
    setSettingsError('')
    setSettingsSuccess('')
    try {
      const saved = await api<AdmissionSettings & { message: string }>('settings/admission-number', token, {
        method: 'PUT',
        body: JSON.stringify({...admissionSettings,admission_prefix:prefix,next_admission_number:sequence}),
      })
      setAdmissionSettings(saved)
      setSettingsSuccess('Admission numbering settings saved successfully.')
      setSettingsSection('home')
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unable to save settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function openStudentProfile(id:number) {
    try { const result=await api<any>('students/'+id+'/profile',token); const contacts=user?.role==='admin'?await api<any[]>('students/'+id+'/guardian-contacts',token):[]; setStudentProfile({...result,guardian_contacts:contacts}); setProfileMessage('') }
    catch(error) { setDataError(error instanceof Error?error.message:'Unable to open student profile.') }
  }

  async function updateGuardianContactVerification(contactId:number,status:'school_verified'|'unverified'|'rejected') {
    try {
      const updated = await api<any>('guardian-contacts/'+contactId+'/verification',token,{
        method:'PATCH',body:JSON.stringify({status}),
      })
      setStudentProfile((current:any)=>current?{
        ...current,
        guardian_contacts:(current.guardian_contacts||[]).map((contact:any)=>contact.id===contactId?updated:contact),
      }:current)
      setProfileMessage(status==='school_verified'?'Guardian phone marked as school-verified.':'Guardian phone verification updated.')
    } catch(error) {
      setProfileMessage(error instanceof Error?error.message:'Unable to update guardian verification.')
    }
  }

  async function dismissStudent(id:number) {
    const reason = window.prompt('Enter the reason for dismissing this student:')
    if (reason === null) return
    if (reason.trim().length < 3) {
      setProfileMessage('Enter a dismissal reason of at least 3 characters.')
      return
    }
    if (!window.confirm('Confirm dismissal? The student will leave active lists, linked parent access will be reviewed, and all historical records will be retained.')) return
    try {
      await api('students/' + id + '/dismiss', token, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim(), effective_date: new Date().toISOString().slice(0, 10) }),
      })
      setStudentProfile((current:any) => current ? {...current, student:{...current.student,status:'dismissed'}} : current)
      setProfileMessage('Student dismissed. Historical records have been retained.')
      await loadStudentPage(studentPage, search)
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Unable to dismiss student.')
    }
  }

  async function saveStudentProfile(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!studentProfile)return
    setProfileSaving(true);setProfileMessage('')
    try {
      const student=studentProfile.student
      const updated=await api<any>('students/'+student.id,token,{method:'PATCH',body:JSON.stringify({
        first_name:student.first_name,middle_name:student.middle_name||null,last_name:student.last_name,
        gender:student.gender||null,date_of_birth:student.date_of_birth||null,religion:student.religion||null,
        nationality:student.nationality||null,phone:student.phone||null,address:student.address||null,
        guardian_name:student.guardian_name||null,guardian_relationship:student.guardian_relationship||null,
        guardian_phone:student.guardian_phone||null,guardian2_name:student.guardian2_name||null,guardian2_relationship:student.guardian2_relationship||null,guardian2_phone:student.guardian2_phone||null,study_mode:student.study_mode||'Day',house:student.house||null,previous_school:student.previous_school||null,
        admission_date:student.admission_date||null,class_id:student.class_id,photo_data:student.photo_data||null
      })})
      const contacts=await api<any[]>('students/'+student.id+'/guardian-contacts',token)
      setStudentProfile({...studentProfile,student:updated.student,guardian_contacts:contacts})
      setProfileMessage('Student profile saved. Existing fee and academic records were retained.')
      await loadStudentPage(studentPage,search)
    } catch(error) {setProfileMessage(error instanceof Error?error.message:'Unable to save student profile.')}
    finally {setProfileSaving(false)}
  }

  async function loadStudentPage(page = 1, query = search) {
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '5', search: query, status: studentArchive ? 'dismissed' : 'active' })
      if (studentClassFilter) params.set('class_id', studentClassFilter)
      const result = await api<StudentPage>('students/search?' + params.toString(), token)
      setStudents(result.items); setStudentTotal(result.total); setStudentPage(result.page)
    } catch (error) { setDataError(error instanceof Error ? error.message : 'Unable to load student records.') }
  }

  useEffect(() => { if (token && active === 'Students') void loadStudentPage(1, search) }, [search, studentClassFilter, studentArchive, active, token])

  useEffect(() => {
    if (!token || !studentForm.class_id) { setStudentForm(old => ({ ...old, fee_amount: '' })); return }
    let cancelled = false
    async function loadClassFee() {
      try {
        const academic = await api<{academic_year:number;active_term:string}>('settings/academic', token)
        const result = await api<{fees:{term:string;amount:number}[]}>('classes/' + studentForm.class_id + '/fees?year=' + academic.academic_year, token)
        const amount = result.fees.find(item => item.term === academic.active_term)?.amount ?? 0
        if (!cancelled) setStudentForm(old => ({ ...old, fee_amount: String(amount) }))
      } catch {
        if (!cancelled) setStudentForm(old => ({ ...old, fee_amount: '' }))
      }
    }
    void loadClassFee()
    return () => { cancelled = true }
  }, [studentForm.class_id, token])

  async function loadUser(authToken: string) {
    try {
      const profile = await api<User>('auth/me', authToken)
      setUser(profile)
      if(profile.role==='teacher') setActive('My Classes')
      else if(profile.role==='parent') setActive('My Children')
      else if(profile.role==='admin') await loadSchoolData(authToken,profile)
      else {
        const allowedItems = getStaffNavigation(profile)
        setActive(allowedItems[0]?.label || 'Overview')
        await loadSchoolData(authToken,profile)
      }
    } catch (error) {
      const connectionUnavailable = error instanceof TypeError || !navigator.onLine
      // Keep the saved token during an outage so the user can reconnect without
      // being signed out permanently. Offline access still requires the separate
      // encrypted snapshot and its offline passphrase.
      if (!connectionUnavailable) void clearStoredSessionToken().catch(() => {})
      setToken('')
      setUser(null)
      setLoginError(connectionUnavailable ? '' : error instanceof Error ? `Sign-in succeeded, but account verification failed: ${error.message}` : 'Sign-in succeeded, but account verification failed.')
    }
  }

  useEffect(() => {
    if (token) void loadUser(token)
  }, [token])

  useEffect(() => {
    if (!token || !user || serverConnection !== 'connected') return
    const deviceId = localStorage.getItem('schoolbridge-sync-device-' + user.id)
    if (!deviceId) { setSyncDeviceRevoked(false); return }
    let cancelled = false
    api<{ devices: { device_id: string; active: boolean }[] }>('sync/devices', token)
      .then(result => {
        if (cancelled) return
        const device = result.devices.find(item => item.device_id === deviceId)
        const revoked = Boolean(device && !device.active)
        setSyncDeviceRevoked(revoked)
        if (revoked) void clearLocalSyncData(user.id, deviceId)
      })
      .catch(() => {
        // A temporary request failure is not evidence that a device was revoked.
      })
    return () => { cancelled = true }
  }, [token, user?.id, serverConnection])

  useEffect(() => {
    if (!token) { setServerConnection('checking'); return }
    let cancelled = false
    async function checkServerConnection() {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 5000)
      try {
        const response = await fetchSchoolBridge(`${API_BASE_URL}/api/health`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })
        const result = await response.json().catch(() => null)
        if (!cancelled) setServerConnection(response.ok && result?.status === 'ok' ? 'connected' : 'disconnected')
      } catch {
        if (!cancelled) setServerConnection('disconnected')
      } finally {
        window.clearTimeout(timeout)
      }
    }
    const handleOffline = () => { if (!cancelled) setServerConnection('disconnected') }
    const handleOnline = () => { if (!cancelled) void checkServerConnection() }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    if (!navigator.onLine) handleOffline()
    else void checkServerConnection()
    const interval = window.setInterval(() => { if (navigator.onLine) void checkServerConnection() }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [token])

  // Keep the encrypted, read-only offline copy aligned with the server change journal.
  // The journal carries invalidations, not record payloads, so any authorised change
  // invalidates the snapshot and requires a fresh, consistent download.
  useEffect(() => {
    if (!token || !user || serverConnection !== 'connected') return
    let cancelled = false
    const pollChanges = async () => {
      if (syncPollInFlight.current || cancelled) return
      const deviceId = localStorage.getItem('schoolbridge-sync-device-' + user.id)
      if (!deviceId) return
      const metaKey = 'schoolbridge-offline-snapshot-meta-' + user.id + '-' + deviceId
      const rawMeta = localStorage.getItem(metaKey)
      if (!rawMeta) return
      syncPollInFlight.current = true
      try {
        const meta = JSON.parse(rawMeta) as { fingerprint: string; sequence: number }
        if (!Number.isSafeInteger(meta.sequence) || meta.sequence < 0) throw new Error('Invalid offline sync cursor.')
        const registeredDevices = await api<{ devices: { device_id: string; active: boolean }[] }>('sync/devices', token)
        if (cancelled) return
        const currentDevice = registeredDevices.devices.find(device => device.device_id === deviceId)
        if (!currentDevice?.active) {
          await deleteEncryptedOfflineSnapshot(user.id, deviceId)
          localStorage.removeItem(metaKey)
          const offlineIndex = readOfflineLoginIndex()
          if (offlineIndex?.userId === user.id && offlineIndex.deviceId === deviceId) {
            localStorage.removeItem('schoolbridge-offline-login-index')
          }
          return
        }
        const account = await api<{ role: string; permissions: Record<string, string[]> }>('auth/me', token)
        if (cancelled) return
        const fingerprint = JSON.stringify({ role: account.role, permissions: Object.fromEntries(Object.entries(account.permissions || {}).sort(([a], [b]) => a.localeCompare(b))) })
        if (meta.fingerprint !== fingerprint) {
          await deleteEncryptedOfflineSnapshot(user.id, deviceId)
          localStorage.removeItem(metaKey)
          localStorage.removeItem('schoolbridge-offline-login-index')
          return
        }
        let cursor = meta.sequence
        for (let page = 0; page < 10; page += 1) {
          const feed = await api<{ changes: unknown[]; next_cursor: number; has_more: boolean }>(
            'sync/changes?device_id=' + encodeURIComponent(deviceId) + '&cursor=' + cursor + '&limit=500', token,
          )
          if (cancelled) return
          if (feed.changes.length) {
            await deleteEncryptedOfflineSnapshot(user.id, deviceId)
            localStorage.removeItem(metaKey)
            localStorage.removeItem('schoolbridge-offline-login-index')
            return
          }
          if (!Number.isSafeInteger(feed.next_cursor) || feed.next_cursor < cursor) throw new Error('The server returned an invalid sync cursor.')
          const previousCursor = cursor
          if (feed.next_cursor > cursor) {
            await api('sync/devices/' + encodeURIComponent(deviceId) + '/checkpoint?sequence=' + feed.next_cursor, token, { method: 'POST' })
            cursor = feed.next_cursor
            localStorage.setItem(metaKey, JSON.stringify({ ...meta, sequence: cursor }))
          }
          if (!feed.has_more || feed.next_cursor === previousCursor) break
        }
      } catch {
        // A transient connection failure must not destroy a still-valid encrypted copy.
      } finally {
        syncPollInFlight.current = false
      }
    }
    void pollChanges()
    const interval = window.setInterval(() => { void pollChanges() }, 15000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [token, user?.id, serverConnection])


  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setLoginError('')
    try {
      const body = new URLSearchParams()
      body.set('username', username)
      body.set('password', password)
      if (selectedSchoolId) body.set('school_id', selectedSchoolId)
      const response = await fetchSchoolBridge(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status >= 500) throw new TypeError('SchoolBridge server is temporarily unavailable.')
        throw new Error(result.detail || 'Login failed')
      }
      await storeSessionToken(result.access_token)
      setToken(result.access_token)
      setPassword('')
    } catch (error) {
      // Only a network outage may activate the local read-only sign-in path.
      if (error instanceof TypeError || !navigator.onLine) {
        try {
          const index=readOfflineLoginIndex()
          if(!index) throw new Error('Offline sign-in has not been prepared for this SchoolBridge installation. Connect and save a fresh encrypted offline copy first.')
          if(index.username.toLowerCase()!==username.trim().toLowerCase()) throw new Error('Use the exact account username saved during online sign-in.')
          const snapshot=await loadEncryptedOfflineSnapshot<OfflineWorkspaceSnapshot>(index.userId,index.deviceId,password)
          if(snapshot.version!==1||snapshot.userId!==index.userId||snapshot.deviceId!==index.deviceId||snapshot.username?.toLowerCase()!==username.trim().toLowerCase()||snapshot.installationId!==index.installationId||(index.schoolId&&snapshot.schoolId!==index.schoolId)||(selectedSchoolId&&snapshot.schoolId!==selectedSchoolId)) throw new Error('The encrypted offline copy does not match this account, device, school, or SchoolBridge installation.')
          if(!snapshot.expiresAt||snapshot.expiresAt<Date.now()||snapshot.downloadedAt>Date.now()+60000) throw new Error('The offline copy has expired. Reconnect and download a fresh copy.')
          setOfflineWorkspace(snapshot)
          setPassword('')
          setLoginError('')
        } catch (offlineError) {
          setLoginError(offlineError instanceof Error ? offlineError.message : 'Offline sign-in is unavailable. Reconnect and try again.')
        }
      } else setLoginError(error instanceof Error ? error.message : 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    const activeToken = token
    if (activeToken) void api('auth/logout', activeToken, { method: 'POST' }).catch(() => {})
    void clearStoredSessionToken().catch(() => {})
    setToken('')
    setUser(null)
    setStudents([])
    setClasses([])
  }

  const filteredStudents = students

  const selectedClass = classes.find(item => String(item.id) === studentForm.class_id)
  const className = (selectedClass?.name || '').toLowerCase().replace(/[.\s_-]/g, '')
  const selectedAcademicLevel = /^(s|senior\s*)[56]$/.test(className) || /senior\s*[56]/.test(className) ? 'A-Level' : /^(s|senior\s*)[1-4]$/.test(className) || /senior\s*[1-4]/.test(className) ? 'O-Level' : ''
  const [artsCombinations, sciencesCombinations] = (schoolConfig.a_level_combinations || '').split(/\r?\n/).reduce((groups: string[][], line: string) => { const match = line.match(/^(ARTS|SCIENCES)::(.*)$/i); if (match && match[2].trim()) groups[match[1].toUpperCase() === 'ARTS' ? 0 : 1].push(match[2].trim()); return groups }, [[], []])

  if (offlineWorkspace) return <OfflineWorkspace snapshot={offlineWorkspace} onExit={()=>setOfflineWorkspace(null)}/>;

  if (!token || !user) {
    if(setupStatus.loading) return <main className="login-page"><section className="login-card"><div className="brand-name">School<span>Bridge</span></div><p className="muted">Checking school installation...</p></section></main>
    const offlineLoginIndex = setupStatus.error ? readOfflineLoginIndex(selectedSchoolId) : null
    if(setupStatus.error && !offlineLoginIndex) return <main className="login-page"><section className="login-card"><div className="brand-name">School<span>Bridge</span></div><h1>{!navigator.onLine ? "You're offline" : setupStatus.error.includes("Select your school") ? "School selection required" : "Unable to check setup"}</h1>{!navigator.onLine ? <p className="form-hint">The app is open, but this device has no prepared offline sign-in yet. Reconnect once, sign in, register this browser and save an encrypted offline copy under Settings → Registered devices. Then you can open that saved read-only workspace without internet.</p> : <p className="error" role="alert">{setupStatus.error}</p>}<p className="form-hint">For shared SchoolBridge access, open the official QR code provided by your school. It identifies the school but does not sign you in.</p><button className="secondary-button" onClick={()=>window.location.reload()}>Try again</button></section></main>
    // A cached offline identity is accepted only when the setup service is unavailable.
    // A reachable, unconfigured database must always complete first-time setup.
    if(!setupStatus.setup_completed && !offlineLoginIndex) return <FirstTimeSetupWizard status={setupStatus} onStatusChange={setSetupStatus}/>
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="brand-mark"><GraduationCap size={30} /></div>
          <div className="brand-name">School<span>Bridge</span></div>
          <p className="login-subtitle">Your school's operations, connected.</p>
          {showRecovery ? <PasswordRecovery schoolId={selectedSchoolId} onBack={()=>setShowRecovery(false)}/> : showRegistration && selectedSchoolId && qrSchoolName && !qrSchoolError ? <RegistrationFlow schoolId={selectedSchoolId} schoolName={qrSchoolName} apiBaseUrl={API_BASE_URL} onBack={()=>setShowRegistration(false)}/> : <>
            <h1>Welcome back</h1>
            <p className="muted">Sign in to your school workspace.</p>
            {qrSchoolName && <p className="form-hint">School: <strong>{qrSchoolName}</strong></p>}
            {!selectedSchoolId && <p className="form-hint">If your school uses shared online access, open its official SchoolBridge QR code first.</p>}
            <form onSubmit={login}>
              <label htmlFor="username">Username</label>
              <input id="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your username" required />
              <label htmlFor="password">Password / offline passphrase</label>
              <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password or offline passphrase" required />
              <p className="form-hint">Offline sign-in works only after you register this browser and save an encrypted offline copy under Settings → Registered devices. Use that offline passphrase when disconnected.</p>
              {loginError && <p className="error">{loginError}</p>}
              <button className="primary-button login-button" disabled={loading || Boolean(qrSchoolError) || (Boolean(selectedSchoolId) && !qrSchoolName)}>
                {loading ? <><LoaderCircle className="spin" size={18} /> Signing in...</> : 'Sign in'}
              </button>
            </form>
            <button type="button" className="recovery-link" onClick={()=>{setShowRecovery(true);setLoginError('')}}>Forgot your password?</button>
            {selectedSchoolId && qrSchoolName && !qrSchoolError && <button type="button" className="recovery-link" onClick={()=>{setShowRegistration(true);setLoginError('')}}>Create a parent or teacher account</button>}
            <p className="login-foot"><ShieldCheck size={15} /> Secure school access</p>
          </>}
        </section>
      </main>
    )
  }

  if (user.must_change_password) return <ForcePasswordChange token={token} username={user.username} onComplete={()=>void loadUser(token)}/>;

  return (
    <div className={`app-shell redesigned-app-shell ${user.role==='admin'||/^(school administrator|system administrator|administrator)$/i.test(user.role_label||'')?'role-theme-admin':/director of studies|\bdos\b/i.test(user.role_label||'')?'role-theme-dos':/bursar|accountant|finance/i.test(user.role_label||'')?'role-theme-finance':/secretary|office administrator/i.test(user.role_label||'')?'role-theme-secretary':/attendance/i.test(user.role_label||'')?'role-theme-attendance':/teacher|head\s?teacher/i.test(user.role_label||'')?'role-theme-teacher':''}`} onSubmitCapture={validateRequiredFields}>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><GraduationCap size={25} /></div>
          <div className="brand-name">School<span>Bridge</span></div>
          <button className="mobile-close" onClick={() => setMobileMenu(false)}><X /></button>
        </div>
        <div className="school-label">SCHOOL MANAGEMENT</div>
        <nav>
          {(user.role === 'parent' ? parentMenu : user.role === 'admin' ? menu : isFinanceAccount(user) ? getStaffNavigation(user).filter(item => ['Overview','Fees & Finance','My Attendance'].includes(item.label)) : getStaffNavigation(user)).map(item => {
            const Icon = item.icon
            return (
              <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} title="Hold for 5 seconds to add this page to your Overview shortcuts" onPointerDown={() => beginShortcutHold(item.label)} onPointerUp={cancelShortcutHold} onPointerLeave={cancelShortcutHold} onPointerCancel={cancelShortcutHold} onContextMenu={event => event.preventDefault()} onClick={() => { if (longPressTriggered.current) { longPressTriggered.current = false; return } if (active !== item.label) setActive(item.label); setMobileMenu(false) }}>
                <Icon size={19} /> <span>{item.label}</span>
                {active === item.label && <span className="active-dot" />}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-account-control">
            {profileMenuOpen && <div className="sidebar-account-menu" role="menu">
              {user.role !== 'parent' && user.role !== 'admin' && <button type="button" role="menuitem" onClick={() => { setActive('My Profile'); setProfileMenuOpen(false); setMobileMenu(false) }}><Contact size={17}/> My profile</button>}
              {user.role === 'admin' && <button type="button" role="menuitem" onClick={() => { setActive('Settings'); setProfileMenuOpen(false); setMobileMenu(false) }}><Settings size={17}/> Settings</button>}
              <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); logout() }}><LogOut size={17}/> Sign out</button>
            </div>}
            <button type="button" className="sidebar-account-trigger" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen(value => !value)}>
              <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
              <span className="profile-info"><strong>Account</strong><small>{user.role_label || user.role}</small></span>
              <span className="account-menu-indicator">{profileMenuOpen ? '−' : '+'}</span>
            </button>
          </div>
        </div>
      </aside>

      {mobileMenu && <button className="mobile-overlay" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)}><Menu /></button>
          <div className="breadcrumb">School workspace <span>/</span> <strong>{active}</strong></div>
          <div className="top-actions">
            <span className={`connection-indicator connection-${serverConnection}`} role="status" aria-live="polite">
              {serverConnection === 'connected' ? <CheckCircle2 size={15}/> : serverConnection === 'disconnected' ? <WifiOff size={15}/> : <Wifi size={15}/>}
              <span>{serverConnection === 'connected' ? (isTauriDesktop ? 'Local SchoolBridge service ready' : 'School server connected') : serverConnection === 'disconnected' ? (!navigator.onLine ? 'Offline — reconnect to refresh live records' : isTauriDesktop ? 'Local SchoolBridge service unavailable' : 'School server unavailable') : (isTauriDesktop ? 'Checking local service' : 'Checking connection')}</span>
            </span>
            <button className="secondary-button refresh-button" type="button" onClick={() => setActive('Device Management')} aria-label="Manage registered devices">Devices</button>
            <button className="secondary-button refresh-button" type="button" onClick={() => void refreshWorkspace()} disabled={isRefreshing} aria-live="polite">
              {isRefreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </header>

        <div className="content">
          {active !== 'Overview' && (
            <div className="welcome-row">
              <div>
                <p className="eyebrow">SCHOOL MANAGEMENT SYSTEM</p>
                <h1>{active === 'Overview' ? (user.role === 'admin' || /school administrator|system administrator|^administrator$/i.test(user.role_label||'') ? 'Administrator command centre' : /director of studies|\bdos\b/i.test(user.role_label||'') ? 'Director of Studies control centre' : /secretary|office administrator/i.test(user.role_label||'') ? 'Administration & records centre' : /attendance/i.test(user.role_label||'') ? 'Attendance operations centre' : /teacher|head\s?teacher/i.test(user.role_label||'') ? 'Teacher workspace' : isFinanceAccount(user) ? 'Finance dashboard' : 'School workspace') : active}</h1>
                <p className="muted">Welcome back, {user.username}. {active === 'Overview' && (user.role === 'admin' || /school administrator|system administrator|^administrator$/i.test(user.role_label||'')) ? 'Your school-wide management overview.' : isFinanceAccount(user) ? 'Here is your finance workspace at a glance.' : 'Here is your assigned school workspace.'}</p>
              </div>
              <div className="date-chip"><CalendarDays size={17} /> {new Date().toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
          )}

          {dataError && <div className="notice">{dataError} <button onClick={() => void loadSchoolData(token)}>Retry</button></div>}
          {syncDeviceRevoked && <div className="notice" role="alert">This browser's synchronisation access has been revoked. SchoolBridge does not currently keep offline copies of API records in this browser. The old device identity remains blocked; open Device Management to register a new identity.</div>}

          {(active === 'My Classes' || active === 'Attendance' || active === 'My Attendance' || active === 'My Results') && user.role === 'teacher' && <TeacherWorkspace token={token} active={active} userId={user.id} />}
          {active === 'My Attendance' && user.role !== 'teacher' && user.role !== 'parent' && user.role !== 'admin' && <StaffSelfAttendance token={token} />}
          {((active === 'Parent Access' || active === 'Announcements') && user.role !== 'parent' || (active === 'My Children' || active === 'Announcements') && user.role === 'parent') && <Phase4Workspace token={token} role={user.role} active={active} permissions={user.permissions} />}

          {active === 'Parent Liaison' && <ParentLiaisonWorkspace token={token} role={user.role} />}
          {active === 'School Community' && <SchoolCommunityWorkspace token={token} />}
          {active === 'Device Management' && <SyncDevices token={token} userId={user.id} isAdmin={user.role === 'admin'} />}
          {active === 'Overview' && user.role === 'admin' && <AdministratorDashboard token={token} username={user.username} onNavigate={setActive} summary={dashboardSummary} financeSummary={financeDashboard} availableSections={['Students','Staff','Fees & Finance','Examinations','Attendance','Timetable','Leadership & Duty','Parent Access','Parent Liaison','Announcements','Reports']}/>} 

                    {active === 'Overview' && user.role !== 'admin' && (user.role === 'staff' && /school administrator|system administrator|^administrator$/i.test(user.role_label||'') ? <AdministratorDashboard token={token} username={user.username} onNavigate={setActive} summary={dashboardSummary} financeSummary={financeDashboard} availableSections={Object.entries(user.permissions||{}).filter(([,actions])=>(actions as string[]).includes('view')).map(([section])=>section)}/> : isFinanceAccount(user) ? <FinanceAccountDashboard token={token} username={user.username} onNavigate={(section,tab)=>{if(tab)setFinanceTabRequest(tab);setActive(section)}}/> : user.role === 'staff' && /director of studies|\bdos\b/i.test(user.role_label||'') ? <DirectorOfStudiesDashboard token={token} onNavigate={setActive} summary={dashboardSummary} summaryAvailable={(user.permissions?.['Overview']||[]).includes('view')} availableSections={Object.entries(user.permissions||{}).filter(([,actions])=>(actions as string[]).includes('view')).map(([section])=>section)}/> : user.role === 'staff' && /secretary|office administrator/i.test(user.role_label||'') ? <SecretaryDashboard username={user.username} onNavigate={setActive} summary={dashboardSummary} availableSections={Object.entries(user.permissions||{}).filter(([,actions])=>(actions as string[]).includes('view')).map(([section])=>section)}/> : user.role === 'staff' && /attendance/i.test(user.role_label||'') ? <AttendanceOfficerDashboard username={user.username} onNavigate={setActive} summary={dashboardSummary} availableSections={Object.entries(user.permissions||{}).filter(([,actions])=>(actions as string[]).includes('view')).map(([section])=>section)}/> : user.role === 'staff' && /teacher|head\s?teacher/i.test(user.role_label||'') ? <TeacherDashboard token={token} username={user.username} onNavigate={setActive}/> : user.role === 'staff' ? <RoleSpecificDashboard username={user.username} roleLabel={user.role_label||'Staff'} onNavigate={setActive} summary={dashboardSummary} summaryAvailable={(user.permissions?.['Overview']||[]).includes('view')} availableSections={Object.entries(user.permissions||{}).filter(([,actions])=>(actions as string[]).includes('view')).map(([section])=>section)} financeSummary={financeDashboard}/> : <PersonalDashboard token={token} username={user.username} onNavigate={setActive}/>) } 
          {active === 'Overview' && <section className="overview-custom-shortcuts panel">
            <div className="panel-heading"><div><h2>My shortcuts</h2><p>Hold any sidebar page for 5 seconds to pin it here. These shortcuts are private to your account.</p></div><span className="shortcut-count">{overviewShortcuts.length} pinned</span></div>
            {overviewShortcuts.length > 0 ? <div className="overview-shortcut-grid">{overviewShortcuts.map((section,index) => {
              const Icon = [...menu,...teacherMenu,...parentMenu].find(item => item.label === section)?.icon || FolderOpen
              return <div className="overview-shortcut-card" key={section}><button type="button" className="overview-shortcut-open" onClick={() => setActive(section)}><span className={`overview-shortcut-icon tone-${index%4}`}><Icon size={19}/></span><strong>{section}</strong><ArrowUpRight size={16}/></button><button type="button" className="overview-shortcut-remove" aria-label={`Remove ${section} shortcut`} title="Remove shortcut" onClick={() => removeOverviewShortcut(section)}><X size={14}/></button></div>
            })}</div> : <div className="overview-shortcut-empty"><Plus size={19}/><span>No shortcuts pinned yet. Press and hold a page in the sidebar for 5 seconds to add it.</span></div>}
          </section>}

          {active === 'Students' && (
            <section className="panel">
              <div className="panel-heading student-workspace-heading"><div><h2>Students</h2><p>{studentTotal.toLocaleString()} registered students · Select a class to view its student list.</p></div>{(user.role === 'admin' || (user.permissions?.['Students'] || []).includes('add')) && <button type="button" className="primary-button add-student-button" onClick={() => { setShowStudentForm(v => !v); setStudentError(''); setStudentSuccess('') }}><UserPlus size={16} /> {showStudentForm ? 'Close registration' : 'Register student'}</button>}</div>
              {studentSuccess && <div className="success-notice">{studentSuccess}</div>}
              {studentError && <div className="form-error">{studentError}</div>}
              {showStudentForm && (user.role === 'admin' || (user.permissions?.['Students'] || []).includes('add')) && (
                <form className="student-form registration-form" onSubmit={registerStudent}>
                  <div className="form-heading">
                    <div><h3>Register a new student</h3><p>Complete the sections below. Compulsory fields are full name, class, gender, parent/guardian name and guardian phone. Other details are optional unless required by the selected class.</p></div>
                    <span className="required-note">* Required</span>
                  </div>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Admission details</h4><p>Choose the class and confirm when the student is joining.</p></div></div>
                    <div className="student-form-grid">
                      <label className="checkbox-field"><input type="checkbox" checked={studentForm.generate_admission_number} onChange={e => setStudentForm({ ...studentForm, generate_admission_number: e.target.checked })} /><span><strong>Generate an admission number</strong><small>Leave unchecked if this school does not use admission numbers.</small></span></label>
                      {studentForm.generate_admission_number && <div className="generated-admission"><strong>Admission number preview</strong><span>Generated when you save</span><b>{[admissionSettings.admission_prefix.trim(), ...(admissionSettings.include_year ? [String(new Date().getFullYear())] : []), String(admissionSettings.next_admission_number).padStart(admissionSettings.admission_padding, '0')].filter(Boolean).join(admissionSettings.admission_separator)}</b></div>}
                      <label>Class *<select required value={studentForm.class_id} onChange={e => setStudentForm({ ...studentForm, class_id: e.target.value, a_level_stream: '', combination: '', optional_subjects: '', subsidiary_subjects: '' })}><option value="">Choose the student's class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` — ${item.section}` : ''}</option>)}</select></label>
                      <label>Student type *<select required value={studentForm.study_mode} onChange={e=>setStudentForm({...studentForm,study_mode:e.target.value})}><option value="Day">Day scholar</option><option value="Boarding">Boarding</option></select></label>
                      <label>House<select value={studentForm.house} onChange={e=>setStudentForm({...studentForm,house:e.target.value})}><option value="">Select house (optional)</option>{(schoolConfig.house_names||'').split(/\r?\n/).map((h:string)=>h.trim()).filter(Boolean).map((h:string)=><option key={h}>{h}</option>)}</select></label>
                      <label>Admission date<input type="date" value={studentForm.admission_date} onChange={e => setStudentForm({ ...studentForm, admission_date: e.target.value })} /><small className="field-hint">Date the student officially joins the school.</small></label>
                      <label>Term fee (UGX)<input type="number" min="0" step="1" value={studentForm.fee_amount} onChange={e => setStudentForm({ ...studentForm, fee_amount: e.target.value })} placeholder="Automatically uses the class fee" /><small className="field-hint">Prefilled from the selected class and active term. You can adjust it if authorised.</small></label>
                    </div>
                  </section>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">02</span><div><h4>Biodata</h4><p>Enter the student's official names and personal details.</p></div></div>
                    <div className="student-form-grid">
                      <label className="field-span-full">Student full name *<input autoComplete="name" value={studentForm.full_name} onChange={e=>setStudentForm({...studentForm,full_name:e.target.value})} placeholder="Enter student's full name" required /></label>
                      <label>Gender *<select required value={studentForm.gender} onChange={e => setStudentForm({ ...studentForm, gender: e.target.value })}><option value="">Select gender</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></label>
                      <label>Date of birth<input type="date" value={studentForm.date_of_birth} onChange={e => setStudentForm({ ...studentForm, date_of_birth: e.target.value })} /></label>
                      <label>Nationality<input autoComplete="country-name" value={studentForm.nationality} onChange={e => setStudentForm({ ...studentForm, nationality: e.target.value })} placeholder="e.g. Ugandan" /></label>
                      <label>Religion<input value={studentForm.religion} onChange={e => setStudentForm({ ...studentForm, religion: e.target.value })} placeholder="Optional" /></label>
                      <label>Student phone<input type="tel" autoComplete="tel" value={studentForm.phone} onChange={e => setStudentForm({ ...studentForm, phone: e.target.value })} placeholder="e.g. 07XX XXX XXX" /></label>
                      <label className="field-span-full">Home address<input autoComplete="street-address" value={studentForm.address} onChange={e => setStudentForm({ ...studentForm, address: e.target.value })} placeholder="Village, parish, town or area" /></label>
                    </div>
                  </section>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">03</span><div><h4>Parent or guardian</h4><p>Provide a contact the school can reach when necessary.</p></div></div>
                    <div className="student-form-grid">
                      <label>Parent / guardian name *<input required autoComplete="name" value={studentForm.guardian_name} onChange={e => setStudentForm({ ...studentForm, guardian_name: e.target.value })} placeholder="Full name" /></label>
                      <label>Relationship<select value={studentForm.guardian_relationship} onChange={e => setStudentForm({ ...studentForm, guardian_relationship: e.target.value })}><option value="">Select relationship</option><option>Parent</option><option>Guardian</option><option>Other relative</option></select></label>
                      <label>Guardian phone (if recorded)<input type="tel" autoComplete="tel" value={studentForm.guardian_phone} onChange={e => setStudentForm({ ...studentForm, guardian_phone: e.target.value })} placeholder="Optional — use the school record" /><small className="field-hint">Leave blank if the school has no verified number. Never invent one.</small></label>
                    </div>
                    <div className="form-section-heading" style={{marginTop:18}}><span className="form-section-number">+</span><div><h4>Additional parent / guardian</h4><p>Optional second guardian contact. Both guardians can share the single linked parent account.</p></div></div>
                    <div className="student-form-grid"><label>Second parent / guardian name<input value={studentForm.guardian2_name} onChange={e=>setStudentForm({...studentForm,guardian2_name:e.target.value})} placeholder="Full name"/></label><label>Relationship<select value={studentForm.guardian2_relationship} onChange={e=>setStudentForm({...studentForm,guardian2_relationship:e.target.value})}><option value="">Select relationship</option><option>Mother</option><option>Father</option><option>Guardian</option><option>Other relative</option></select></label><label>Phone number<input type="tel" value={studentForm.guardian2_phone} onChange={e=>setStudentForm({...studentForm,guardian2_phone:e.target.value})} placeholder="e.g. 07XX XXX XXX"/></label></div>
                  </section>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">04</span><div><h4>Previous education</h4><p>If the student is joining from another school, record it here.</p></div></div>
                    <div className="student-form-grid">
                      <label>Previous school<input value={studentForm.previous_school} onChange={e => setStudentForm({ ...studentForm, previous_school: e.target.value })} placeholder="Name of previous school (optional)" /></label>
                    </div>
                  </section>

                  {schoolConfig.school_type!=='Primary'&&selectedAcademicLevel==='A-Level'&&<section className="form-section"><div className="form-section-heading"><span className="form-section-number">05</span><div><h4>A-Level subject choices</h4><p>The selected class determines A-Level automatically. Choose Arts or Sciences, then its combinations.</p></div></div><div className="student-form-grid"><label>A-Level stream *<select required value={studentForm.a_level_stream} onChange={e=>setStudentForm({...studentForm,a_level_stream:e.target.value,combination:''})}><option value="">Choose Arts or Sciences</option><option value="Arts">Arts</option><option value="Sciences">Sciences</option></select></label>{studentForm.a_level_stream&&<label>Combination *<select required value={studentForm.combination} onChange={e=>setStudentForm({...studentForm,combination:e.target.value})}><option value="">Select combination</option>{(studentForm.a_level_stream==='Arts'?artsCombinations:sciencesCombinations).map((x:string)=><option key={x}>{x}</option>)}</select></label>}<label className="field-span-full">Subsidiary subjects<select multiple size={5} value={studentForm.subsidiary_subjects?studentForm.subsidiary_subjects.split(',').filter(Boolean):[]} onChange={e=>setStudentForm({...studentForm,subsidiary_subjects:Array.from(e.target.selectedOptions).map(o=>o.value).join(',')})}>{(schoolConfig.a_level_subsidiary_subjects||'').split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean).map((x:string)=><option key={x}>{x}</option>)}</select><small className="field-hint">Select more than one subsidiary subject using Ctrl/Command-click.</small></label></div></section>}{schoolConfig.school_type!=='Primary'&&selectedAcademicLevel==='O-Level'&&<section className="form-section"><div className="form-section-heading"><span className="form-section-number">05</span><div><h4>O-Level optional subjects</h4><p>The selected class determines O-Level automatically.</p></div></div><div className="student-form-grid"><label className="field-span-full">Optional subjects<select multiple size={5} value={studentForm.optional_subjects?studentForm.optional_subjects.split(',').filter(Boolean):[]} onChange={e=>setStudentForm({...studentForm,optional_subjects:Array.from(e.target.selectedOptions).map(o=>o.value).join(',')})}>{(schoolConfig.o_level_optional_subjects||'').split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean).map((x:string)=><option key={x}>{x}</option>)}</select><small className="field-hint">Select more than one optional subject using Ctrl/Command-click.</small></label></div></section>}
                  {classes.length === 0 && <p className="form-hint">No classes are available yet. Add a class under Settings → Classes & Streams before registering students.</p>}
                  <div className="form-actions registration-actions"><button type="button" className="secondary-button" onClick={() => setShowStudentForm(false)}>Cancel</button><button className="primary-button" disabled={savingStudent || classes.length === 0}>{savingStudent ? <><LoaderCircle className="spin" size={16} /> Saving student...</> : 'Register student'}</button></div>
                </form>
              )}
              <section className="student-class-browser">
                <div className="student-class-browser-heading"><div><h3>Browse by class</h3><p>Choose a class or stream to see only its students.</p></div><span>{classes.length} classes</span></div>
                <div className="student-class-tabs" role="tablist" aria-label="Student classes">
                  <button type="button" role="tab" aria-selected={!studentClassFilter} className={!studentClassFilter?'student-class-tab active':'student-class-tab'} onClick={()=>{setStudentClassFilter('');setStudentPage(1)}}>All students</button>
                  {classes.map(item=><button type="button" role="tab" aria-selected={studentClassFilter===String(item.id)} className={studentClassFilter===String(item.id)?'student-class-tab active':'student-class-tab'} key={item.id} onClick={()=>{setStudentClassFilter(String(item.id));setStudentPage(1)}}>{item.name}{item.section? ` · ${item.section}`:''}</button>)}
                </div>
              </section>
              <div className="student-search-panel"><div className="search-box"><Search size={19}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={studentClassFilter?'Search this class by student name or admission number...':'Search all students by name or admission number...'} aria-label="Search students by name or admission number"/></div><button type="button" className="secondary-button" onClick={()=>{setStudentArchive(value=>!value);setStudentPage(1);setStudentClassFilter('')}}>{studentArchive?'Back to active students':'View dismissed archive'}</button><span>{studentArchive?'Dismissed student history':'Search results update automatically'}</span></div>
              <div className="student-list-heading"><div><h3>{studentArchive?'Dismissed student archive':studentClassFilter ? (classes.find(item=>String(item.id)===studentClassFilter)?.name||'Selected class') : 'All students'}{!studentArchive && studentClassFilter && classes.find(item=>String(item.id)===studentClassFilter)?.section ? ` · ${classes.find(item=>String(item.id)===studentClassFilter)?.section}` : ''}</h3><p>{studentTotal.toLocaleString()} matching student records</p></div></div><StudentTable students={filteredStudents} classes={classes} onSelect={id => void openStudentProfile(id)} />
              <div className="pagination-row"><span>Showing {students.length ? (studentPage - 1) * 25 + 1 : 0}–{Math.min(studentPage * 25, studentTotal)} of {studentTotal}</span><div><button className="secondary-button" disabled={studentPage <= 1} onClick={() => void loadStudentPage(studentPage - 1)}>Previous</button><button className="secondary-button" disabled={studentPage * 25 >= studentTotal} onClick={() => void loadStudentPage(studentPage + 1)}>Next</button></div></div>
            </section>
          )}



          <StaffFinance token={token} active={active} classes={classes} refreshKey={refreshKey} initialTab={financeTabRequest} canAddStaff={user.role === 'admin' || (user.permissions?.['Staff'] || []).includes('add')} canVerifyStaffContacts={user.role === 'admin'} />
          {studentProfile && (
            <div className="modal-backdrop" onClick={()=>setStudentProfile(null)}>
              <section className="panel student-profile-modal" onClick={e=>e.stopPropagation()}>
                <div className="panel-heading"><div className="student-profile-heading"><div className="student-avatar profile-avatar">{studentProfile.student.photo_data?<img src={studentProfile.student.photo_data} alt="Student passport photo"/>:(studentProfile.student.first_name||'?').slice(0,1).toUpperCase()}</div><div><h2>Student profile</h2><p>{studentProfile.student.admission_number} · {studentProfile.student.status}</p></div></div><div className="profile-actions"><button className="secondary-button" type="button" onClick={()=>void dismissStudent(studentProfile.student.id)} disabled={studentProfile.student.status==='dismissed'}>Dismiss student</button><button className="secondary-button" type="button" onClick={()=>setStudentProfile(null)}>Close</button></div></div>
                {profileMessage&&<div className="success-notice">{profileMessage}</div>}
                <section className="student-profile-details" aria-label="Student registration details" style={{display:"block",visibility:"visible",opacity:1,position:"relative",zIndex:1}}>
                  <div className="panel-heading"><div><h3>Admission details</h3><p>Essential information captured during registration</p></div></div>
                  <div className="student-form-grid">
                    <div><small>Admission number</small><strong>{studentProfile.student.admission_number||'—'}</strong></div>
                    <div><small>Class / stream</small><strong>{classes.find(c=>c.id===studentProfile.student.class_id)?.name||'—'}{classes.find(c=>c.id===studentProfile.student.class_id)?.section?' — '+classes.find(c=>c.id===studentProfile.student.class_id)?.section:''}</strong></div>
                    <div><small>Admission date</small><strong>{studentProfile.student.admission_date||'—'}</strong></div>
                    <div><small>Student status</small><strong>{studentProfile.student.status||'Active'}</strong></div>
                  </div>
                  <div className="panel-heading"><div><h3>Student biodata</h3></div></div>
                  <div className="student-form-grid">
                    <div><small>Full name</small><strong>{[studentProfile.student.first_name,studentProfile.student.middle_name,studentProfile.student.last_name].filter(Boolean).join(' ')||'—'}</strong></div>
                    <div><small>Gender</small><strong>{studentProfile.student.gender||'—'}</strong></div>
                    <div><small>Date of birth</small><strong>{studentProfile.student.date_of_birth||'—'}</strong></div>
                    <div><small>Nationality</small><strong>{studentProfile.student.nationality||'—'}</strong></div>
                    <div><small>Religion</small><strong>{studentProfile.student.religion||'—'}</strong></div>
                    <div><small>Student phone</small><strong>{studentProfile.student.phone||'—'}</strong></div>
                    <div className="field-span-full"><small>Home address</small><strong>{studentProfile.student.address||'—'}</strong></div>
                  </div>
                  <div className="panel-heading"><div><h3>Parent / guardian</h3></div></div>
                  <div className="student-form-grid">
                    <div><small>Parent / guardian name</small><strong>{studentProfile.student.guardian_name||'—'}</strong></div>
                    <div><small>Relationship</small><strong>{studentProfile.student.guardian_relationship||'—'}</strong></div>
                    <div><small>Guardian phone</small><strong>{studentProfile.student.guardian_phone||'—'}</strong></div><div><small>Second guardian</small><strong>{studentProfile.student.guardian2_name||'—'}</strong></div><div><small>Second guardian relationship</small><strong>{studentProfile.student.guardian2_relationship||'—'}</strong></div><div><small>Second guardian phone</small><strong>{studentProfile.student.guardian2_phone||'—'}</strong></div><div><small>Study mode</small><strong>{studentProfile.student.study_mode||'Day'}</strong></div><div><small>House</small><strong>{studentProfile.student.house||'—'}</strong></div>
                  </div>
                  {user.role === 'admin' && <><div className="panel-heading"><div><h3>Trusted guardian contacts</h3><p>Only numbers confirmed by the school can be used for parent identity verification.</p></div></div>
                  <div className="table-wrap"><table><thead><tr><th>Guardian</th><th>Relationship</th><th>Recorded phone</th><th>School verification</th><th>Action</th></tr></thead><tbody>
                    {(studentProfile.guardian_contacts||[]).map((contact:any)=><tr key={contact.id}>
                      <td>{contact.guardian_name}</td><td>{contact.relationship||'—'}</td><td>{contact.phone||'Not recorded'}</td>
                      <td><span className={contact.verification_status==='school_verified'?'status-pill success':'status-pill pending'}>{contact.verification_status==='school_verified'?'School verified':contact.verification_status==='rejected'?'Rejected':'Unverified'}</span></td>
                      <td><button type="button" className="secondary-button" disabled={!contact.phone} onClick={()=>void updateGuardianContactVerification(contact.id,contact.verification_status==='school_verified'?'unverified':'school_verified')}>{contact.verification_status==='school_verified'?'Revoke verification':contact.phone?'Mark school-verified':'Phone missing'}</button></td>
                    </tr>)}
                    {!(studentProfile.guardian_contacts||[]).length&&<tr><td colSpan={5}>No guardian contacts are recorded.</td></tr>}
                  </tbody></table></div>
                  </>}
                  <div className="panel-heading"><div><h3>Previous education</h3></div></div>
                  <div className="student-form-grid">
                    <div><small>Previous school</small><strong>{studentProfile.student.previous_school||'—'}</strong></div>
                    <div><small>Academic level</small><strong>{studentProfile.student.academic_level||'—'}</strong></div>
                    <div><small>Combination / subjects</small><strong>{studentProfile.student.combination||studentProfile.student.optional_subjects||'—'}</strong></div>
                  </div>
                </section>
                <details className="form-disclosure"><summary>Edit student details</summary><form className="student-form" onSubmit={saveStudentProfile}>
                  <div className="student-form-grid">
                    <label className="field-span-full">Passport photo <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1200000){setProfileMessage('Choose a passport photo no larger than 1.2 MB.');return}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setProfileMessage('Choose a JPG, PNG or WEBP image.');return}const reader=new FileReader();reader.onload=()=>setStudentProfile((current:any)=>current?{...current,student:{...current.student,photo_data:String(reader.result||'')}}:current);reader.onerror=()=>setProfileMessage('Unable to read the selected photo.');reader.readAsDataURL(file)}}/><small className="field-hint">Optional during registration. Add it here later to complete the student profile. Maximum 1.2 MB.</small>{studentProfile.student.photo_data?<span className="photo-status">Passport photo added</span>:<span className="photo-status pending">Passport photo pending — required to complete the profile</span>}</label>
                    <label>First name<input required value={studentProfile.student.first_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,first_name:e.target.value}})}/></label>
                    <label>Middle name<input value={studentProfile.student.middle_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,middle_name:e.target.value}})}/></label>
                    <label>Last name<input required value={studentProfile.student.last_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,last_name:e.target.value}})}/></label>
                    <label>Study mode<select value={studentProfile.student.study_mode||'Day'} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,study_mode:e.target.value}})}><option>Day</option><option>Boarding</option></select></label>
                    <label>House<select value={studentProfile.student.house||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,house:e.target.value}})}><option value="">No house</option>{(schoolConfig.house_names||'').split(/\r?\n/).map((h:string)=>h.trim()).filter(Boolean).map((h:string)=><option key={h}>{h}</option>)}</select></label>
                    <label>Class<select value={studentProfile.student.class_id||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,class_id:e.target.value?Number(e.target.value):null}})}><option value="">Unassigned</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}{c.section?' — '+c.section:''}</option>)}</select></label>
                    <label>Gender<select value={studentProfile.student.gender||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,gender:e.target.value}})}><option value="">Not specified</option><option>Male</option><option>Female</option><option>Other</option></select></label>
                    <label>Date of birth<input type="date" value={studentProfile.student.date_of_birth||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,date_of_birth:e.target.value}})}/></label>
                    <label>Religion<input value={studentProfile.student.religion||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,religion:e.target.value}})}/></label>
                    <label>Nationality<input value={studentProfile.student.nationality||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,nationality:e.target.value}})}/></label>
                    <label>Student phone<input value={studentProfile.student.phone||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,phone:e.target.value}})}/></label>
                    <label>Guardian relationship<input value={studentProfile.student.guardian_relationship||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,guardian_relationship:e.target.value}})}/></label>
                    <label>Previous school<input value={studentProfile.student.previous_school||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,previous_school:e.target.value}})}/></label>
                    <label>Admission date<input type="date" value={studentProfile.student.admission_date||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,admission_date:e.target.value}})}/></label>
                    <label>Home address<input value={studentProfile.student.address||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,address:e.target.value}})}/></label>
                    <label>Parent / guardian<input value={studentProfile.student.guardian_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,guardian_name:e.target.value}})}/></label>
                    <label>Guardian phone<input value={studentProfile.student.guardian_phone||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,guardian_phone:e.target.value}})}/></label>
                    <label>Second guardian name<input value={studentProfile.student.guardian2_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,guardian2_name:e.target.value}})}/></label><label>Second guardian relationship<input value={studentProfile.student.guardian2_relationship||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,guardian2_relationship:e.target.value}})}/></label><label>Second guardian phone<input value={studentProfile.student.guardian2_phone||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,guardian2_phone:e.target.value}})}/></label>
                    <div><small>Student status</small><strong>{studentProfile.student.status||'active'}</strong><p className="field-hint">Use the formal dismissal action to dismiss a student.</p></div>
                  </div>
                  <div className="form-actions"><button className="primary-button" disabled={profileSaving||!studentProfile.student.photo_data}>{profileSaving?'Saving...':studentProfile.student.photo_data?'Save student profile':'Add a passport photo to complete the profile'}</button></div>
                </form></details>
                <div className="panel-heading"><div><h3>Fee history</h3><p>All historic charges and payments for this student</p></div></div>
                <div className="stats-grid finance-stats"><div className="stat-card"><span>Total charged</span><strong className="stat-value">UGX {Number(studentProfile.total_charged||0).toLocaleString()}</strong></div><div className="stat-card"><span>Total paid</span><strong className="stat-value">UGX {Number(studentProfile.total_paid||0).toLocaleString()}</strong></div><div className="stat-card"><span>Balance</span><strong className="stat-value">UGX {Number(studentProfile.total_balance||0).toLocaleString()}</strong></div></div>
                <div className="table-wrap"><table><thead><tr><th>Term</th><th>Year</th><th>Charged</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{studentProfile.fees.map((fee:any)=><tr key={fee.charge_id}><td>{fee.term}</td><td>{fee.year}</td><td>{Number(fee.amount).toLocaleString()}</td><td>{Number(fee.paid).toLocaleString()}</td><td>{Number(fee.balance).toLocaleString()}</td></tr>)}</tbody></table></div>
                <div className="panel-heading"><div><h3>Payment history</h3><p>Individual payments and receipt references</p></div></div>
                <div className="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Term</th><th>Method</th><th>Amount (UGX)</th></tr></thead><tbody>{studentProfile.fees.flatMap((fee:any)=>fee.payments.map((payment:any)=><tr key={payment.id}><td>{payment.date}</td><td>{payment.receipt_number||payment.reference||'—'}</td><td>{fee.term} {fee.year}</td><td>{payment.method}</td><td>{Number(payment.amount).toLocaleString()}</td></tr>))}</tbody></table></div>
              </section>
            </div>
          )}
          {active === 'Examinations' && user.role !== 'parent' && <AcademicManagement token={token} classes={classes} userId={user.id} isTeacher={user.role === 'teacher'} isAdmin={user.role === 'admin'} canVerify={user.role === 'admin' || (user.permissions?.['Examinations'] || []).includes('approve')} />}
          {active === 'Attendance' && user.role !== 'parent' && user.role !== 'teacher' && <AttendanceHub token={token} userId={user.id} canViewStudents={user.role === 'admin' || (user.permissions?.['Attendance'] || []).includes('view')} canViewStaff={user.role === 'admin' || (user.permissions?.['Staff Attendance'] || []).includes('view')} canEditStudents={user.role === 'admin' || (user.permissions?.['Attendance'] || []).includes('edit')} permissions={user.permissions} isAdmin={user.role === 'admin'} roleLabel={user.role_label || ''} />}
          {active === 'Timetable' && user.role !== 'parent' && <OperationsManagement token={token} active={active} permissions={user.permissions} isAdmin={user.role === 'admin'} roleLabel={user.role_label || ''} />}
          {active === 'My Profile' && user.role !== 'parent' && user.role !== 'admin' && <MyStaffProfile token={token} />}
          {active === 'Leadership & Duty' && user.role !== 'parent' && <LeadershipDuty token={token} />}
          <div className="settings-page-cache" style={{display:active==='Settings'?'':'none'}}>
          {settingsSection === 'home' && (
            <section className="settings-hub">
              <div className="panel-heading"><div><h2>School settings</h2><p>Choose a category to configure how SchoolBridge works for this school.</p></div></div>
              <div className="settings-category-grid">
                <button className="settings-category" onClick={() => setSettingsSection('school')}><span className="settings-category-icon"><GraduationCap /></span><strong>School Profile & Admissions</strong><small>School identity, student and teacher admission setup</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('classes')}><span className="settings-category-icon"><BookOpen /></span><strong>Classes & Streams</strong><small>Create classes, streams and manage class fees</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('academy')}><span className="settings-category-icon"><CalendarDays /></span><strong>Academy</strong><small>Academic year, terms, subjects and curriculum</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('users')}><span className="settings-category-icon"><ShieldCheck /></span><strong>Users & Permissions</strong><small>Teaching and non-teaching staff roles, tabs and actions</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('backups')}><span className="settings-category-icon"><Settings /></span><strong>Backups & Restore</strong><small>Protect and restore school records</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('audit')}><span className="settings-category-icon"><ShieldCheck /></span><strong>Audit Log</strong><small>Review important changes and financial actions</small><ArrowUpRight /></button>
              </div>
            </section>
          )}
          {settingsSection !== 'home' && (
            <div className="settings-detail">
              <button className="settings-back" onClick={() => setSettingsSection('home')}>← All settings</button>
              
              {settingsSection === 'admission' && (
            <section className="panel settings-panel">
              <div className="panel-heading"><div><h2>Admission number settings</h2><p>Choose the format used for newly registered students at this school.</p></div></div>
              {settingsSuccess && <div className="success-notice" role="status">{settingsSuccess}</div>}
              {settingsError && <div className="form-error" role="alert">{settingsError}</div>}
              <details className="form-disclosure"><summary>Edit admission number settings</summary><form className="student-form" onSubmit={saveAdmissionSettings}>
                <div className="student-form-grid">
                  <label>School prefix *<input required maxLength={20} value={admissionSettings.admission_prefix} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_prefix: e.target.value })} placeholder="e.g. KIS" /></label>
                  <label>Separator<select value={admissionSettings.admission_separator} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_separator: e.target.value })}><option value="-">Hyphen (-)</option><option value="/">Slash (/)</option><option value="">None</option></select></label>
                  <label>Number of digits<select value={admissionSettings.admission_padding} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_padding: Number(e.target.value) })}>{[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} digits</option>)}</select></label>
                  <label>Next sequence number<input type="number" min="1" value={admissionSettings.next_admission_number} onChange={e => setAdmissionSettings({ ...admissionSettings, next_admission_number: Math.max(1, Number(e.target.value)) })} required /></label>
                  <button type="button" className={admissionSettings.include_year ? "choice-toggle active" : "choice-toggle"} aria-pressed={admissionSettings.include_year} onClick={() => setAdmissionSettings({ ...admissionSettings, include_year: !admissionSettings.include_year })}>Include current year · {admissionSettings.include_year ? "Yes" : "No"}</button>
                </div>
                <div className="number-preview"><span>Example of next admission number</span><strong>{[admissionSettings.admission_prefix.trim(), ...(admissionSettings.include_year ? [String(new Date().getFullYear())] : []), String(admissionSettings.next_admission_number).padStart(admissionSettings.admission_padding, '0')].filter(Boolean).join(admissionSettings.admission_separator)}</strong></div>
                <p className="form-hint">These settings affect new registrations only. Existing admission numbers will not be changed.</p>
                <div className="form-actions"><button className="primary-button" disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save numbering settings'}</button></div>
              </form></details>
            </section>
              )}
              {settingsSection === 'school' && <SchoolProfileAdmissionsHub token={token} onProfileSaved={() => { api<any>('settings/school-profile',token).then(setSchoolConfig).catch(()=>{}) }} />}
              {settingsSection === 'academy' && <AcademySettingsHub token={token} schoolType={schoolConfig.school_type === 'Combined' ? 'Combined' : schoolConfig.school_type !== 'Primary' ? 'Secondary' : 'Primary'} onSaved={() => setSettingsSection('home')} />}
              {settingsSection === 'users' && <TeacherUsersSettings token={token} classes={classes} onSaved={() => { setRefreshKey(value => value + 1) }} />}
              {settingsSection === 'backups' && <BackupSettings token={token} />}
              {settingsSection === 'audit' && <AuditLogSettings token={token} />}
            </div>
          )}
          {settingsSection === 'classes' && (
            <section className="panel">
              <div className="panel-heading"><div><h2>School classes</h2><p>Classes registered in the system</p></div><button className="primary-button add-student-button" onClick={() => { setShowClassForm(v => !v); setClassError(''); setClassSuccess(''); if (!showClassForm) { setClassForm({ name: '', section: '' }) } }}><Plus size={16} /> {showClassForm ? 'Close form' : 'Add class'}</button></div>
              {classSuccess && <div className="success-notice">{classSuccess}</div>}
              {classError && <div className="form-error">{classError}</div>}
              {showClassForm && <form className="student-form class-form" onSubmit={registerClass}><div className="form-heading"><div><h3>Create a school class</h3><p>Choose a class for the school type saved in School Profile. A stream is optional.</p></div></div><div className="student-form-grid class-form-grid"><label>Class name *<select required value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })}><option value="">Choose a class</option>{((schoolConfig.school_type || 'Primary') === 'Primary' ? Array.from({length:7},(_,i)=>'Primary '+(i+1)) : schoolConfig.school_type === 'Combined' ? [...Array.from({length:7},(_,i)=>'Primary '+(i+1)),...Array.from({length:6},(_,i)=>'Senior '+(i+1))] : Array.from({length:6},(_,i)=>'Senior '+(i+1))).map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>Stream (optional)<input value={classForm.section} onChange={e => setClassForm({ ...classForm, section: e.target.value })} placeholder="e.g. East, A, Arts or Sciences" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowClassForm(false)}>Cancel</button><button className="primary-button" disabled={savingClass || !classForm.name.trim()}>{savingClass ? 'Saving...' : 'Save class'}</button></div></form>}
              <div className="class-grid">{classes.map(item => <div className="class-card" key={item.id}><BookOpen size={22} /><strong>{item.name}</strong><span>{item.section || 'No stream'}</span><button type="button" className="secondary-button" disabled={deletingClassId===item.id} onClick={() => void deleteClass(item)}>{deletingClassId===item.id ? 'Removing...' : 'Remove class'}</button></div>)}</div>
              {classes.length === 0 && <EmptyState text="No classes have been added yet." />}
            </section>
          )}

          </div>
          <footer className="footer"><span>SchoolBridge</span> · School management made simpler <span className="footer-version">Version 0.1 · Local workspace</span></footer>
        </div>
      </main>
    </div>
  )
}

function StatCard({ title, value, icon, note }: { title: string; value: string | number; icon: React.ReactNode; note: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><small><TrendingUp size={14} /> {note}</small></div>
}

function StudentTable({ students, classes = [], onSelect }: { students: RecordItem[]; classes?: RecordItem[]; onSelect:(id:number)=>void }) {
  if (!students.length) return <EmptyState text="No student records to display yet." />
  return (
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Gender</th><th>Class</th></tr></thead><tbody>
      {students.map(student => <tr key={student.id} className="clickable-row" onClick={()=>onSelect(student.id)}><td><div className="student-cell"><div className="student-avatar">{student.photo_data?<img src={student.photo_data} alt=""/>:(student.first_name || '?').slice(0, 1).toUpperCase()}</div><strong>{student.first_name} {student.last_name}</strong></div></td><td>{student.admission_number}</td><td>{student.gender || '—'}</td><td>{classes.find(item => item.id === student.class_id) ? (classes.find(item => item.id === student.class_id)?.name + (classes.find(item => item.id === student.class_id)?.section ? ' — ' + classes.find(item => item.id === student.class_id)?.section : '')) : '—'}</td></tr>)}
    </tbody></table></div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><GraduationCap size={30} /><p>{text}</p></div>
}

export default App


function SchoolProfileAdmissionsHub({token,onProfileSaved}:{token:string;onProfileSaved:()=>void}) {
  const [tab,setTab]=useState<'profile'|'students'|'teachers'>('profile')
  return <section className="settings-hub-subpage">
    <div className="settings-section-tabs" role="tablist" aria-label="School profile and admissions">
      <button type="button" role="tab" aria-selected={tab==='profile'} className={tab==='profile'?'active':''} onClick={()=>setTab('profile')}>School Profile</button>
      <button type="button" role="tab" aria-selected={tab==='students'} className={tab==='students'?'active':''} onClick={()=>setTab('students')}>Student Admissions</button>
      <button type="button" role="tab" aria-selected={tab==='teachers'} className={tab==='teachers'?'active':''} onClick={()=>setTab('teachers')}>Teacher Admissions</button>
    </div>
    {tab==='profile'&&<SchoolProfileSettings token={token} onSaved={onProfileSaved}/>}
    {tab==='students'&&<AdmissionNumberSettings token={token}/>}
    {tab==='teachers'&&<section className="panel settings-panel"><div className="panel-heading"><div><h2>Teacher & staff admissions</h2><p>Staff are admitted through the Staff workspace, where their employment profile is created before login access is assigned.</p></div></div><div className="teacher-admission-checklist"><div><strong>01 · Staff identity</strong><span>Record the staff number, full name and contact details.</span></div><div><strong>02 · Employment details</strong><span>Choose teaching or non-teaching category, job title, department and house.</span></div><div><strong>03 · Teaching profile</strong><span>For teachers, record registered subjects and class responsibilities.</span></div><div><strong>04 · Account access</strong><span>Assign a login, role and permitted SchoolBridge workspaces under Users & Permissions.</span></div></div><p className="form-hint">Open Staff from the main menu to register a new teacher or staff member. Their account and permissions are managed separately after registration.</p></section>}
  </section>
}

function AdmissionNumberSettings({token}:{token:string}) {
  const [settings,setSettings]=useState<AdmissionSettings>({admission_prefix:'SB',include_year:true,admission_separator:'-',admission_padding:4,next_admission_number:1})
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  useEffect(()=>{api<AdmissionSettings>('settings/admission-number',token).then(setSettings).catch(e=>setError(e.message))},[token])
  async function save(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');setMessage('');try{const saved=await api<AdmissionSettings>('settings/admission-number',token,{method:'PUT',body:JSON.stringify(settings)});setSettings(saved);setMessage('Student admission number format saved.')}catch(e){setError(e instanceof Error?e.message:'Unable to save student admission settings.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Student admission setup</h2><p>Configure the admission number generated for each newly registered student.</p></div></div>{error&&<div className="form-error" role="alert">{error}</div>}{message&&<div className="success-notice" role="status">{message}</div>}<form className="student-form" onSubmit={save}><div className="student-form-grid"><label>School prefix *<input required maxLength={20} value={settings.admission_prefix} onChange={e=>setSettings({...settings,admission_prefix:e.target.value})}/></label><label>Separator<select value={settings.admission_separator} onChange={e=>setSettings({...settings,admission_separator:e.target.value})}><option value="-">Hyphen (-)</option><option value="/">Slash (/)</option><option value="">None</option></select></label><label>Number of digits<select value={settings.admission_padding} onChange={e=>setSettings({...settings,admission_padding:Number(e.target.value)})}>{[3,4,5,6,7,8].map(n=><option key={n} value={n}>{n} digits</option>)}</select></label><label>Next sequence number<input type="number" min="1" required value={settings.next_admission_number} onChange={e=>setSettings({...settings,next_admission_number:Math.max(1,Number(e.target.value))})}/></label></div><button type="button" className={settings.include_year?'choice-toggle active':'choice-toggle'} aria-pressed={settings.include_year} onClick={()=>setSettings({...settings,include_year:!settings.include_year})}>Include current year · {settings.include_year?'Yes':'No'}</button><div className="number-preview"><span>Next student admission number</span><strong>{[settings.admission_prefix.trim(),...(settings.include_year?[String(new Date().getFullYear())]:[]),String(settings.next_admission_number).padStart(settings.admission_padding,'0')].filter(Boolean).join(settings.admission_separator)}</strong></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save student admission setup'}</button></div></form></section>
}

function AcademySettingsHub({token,schoolType,onSaved}:{token:string;schoolType:'Primary'|'Secondary'|'Combined';onSaved:()=>void}) {
  const [tab,setTab]=useState<'calendar'|'curriculum'>('calendar')
  return <section className="settings-hub-subpage"><div className="settings-section-tabs" role="tablist" aria-label="Academy settings"><button type="button" role="tab" aria-selected={tab==='calendar'} className={tab==='calendar'?'active':''} onClick={()=>setTab('calendar')}>Academic Year & Terms</button><button type="button" role="tab" aria-selected={tab==='curriculum'} className={tab==='curriculum'?'active':''} onClick={()=>setTab('curriculum')}>Curriculum & Subjects</button></div>{tab==='calendar'&&<AcademicSettings token={token} onSaved={onSaved}/>}{tab==='curriculum'&&<><AcademicCurriculumSettings token={token} onSaved={onSaved}/><SubjectSettings token={token} schoolType={schoolType}/></>}</section>
}

function AcademicSettings({token,onSaved}:{token:string;onSaved:()=>void}) {
  const [year,setYear]=useState(new Date().getFullYear())
  const [term,setTerm]=useState('Term 1')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api<{academic_year:number;active_term:string}>('settings/academic',token).then(x=>{setYear(x.academic_year);setTerm(x.active_term)}).catch(e=>setMessage(e.message))},[token])
  async function save(e:React.FormEvent) {e.preventDefault();setBusy(true);setMessage('');try{await api('settings/academic',token,{method:'PUT',body:JSON.stringify({academic_year:year,active_term:term})});setMessage('Active academic year and term saved. New registrations will use this term.');onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to save academic settings.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Academic year and active term</h2><p>These settings determine which class fee is assigned to new students.</p></div></div>{message&&<div className="success-notice">{message}</div>}<details className="form-disclosure"><summary>Edit academic year and active term</summary><form className="student-form" onSubmit={save}><div className="student-form-grid"><label>Academic year *<input required type="number" min="2000" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))}/></label><label>Active term *<select required value={term} onChange={e=>setTerm(e.target.value)}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save academic settings'}</button></div></form></details></section>
}

type StaffSelfAttendanceRecord = {id:number;attendance_date:string;status:string;notes?:string|null;check_in_at?:string|null;check_out_at?:string|null}
type StaffSelfAttendanceData = {staff_name:string;staff_number:string;today:{attendance_date:string;status:string;check_in_at?:string|null;check_out_at?:string|null};records:StaffSelfAttendanceRecord[]}

function StaffSelfAttendance({token}:{token:string}) {
  const [data,setData]=useState<StaffSelfAttendanceData|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  async function refresh() {
    setLoading(true);setError('')
    try { setData(await api<StaffSelfAttendanceData>('me/staff-attendance',token)) }
    catch(e) { setError(e instanceof Error?e.message:'Unable to load your staff attendance.') }
    finally { setLoading(false) }
  }
  useEffect(()=>{void refresh()},[token])
  async function act(action:'check-in'|'check-out') {
    setBusy(true);setError('');setNotice('')
    try {
      const result=await api<{message:string}>(`me/staff-attendance/${action}`,token,{method:'POST'})
      setNotice(result.message);setData(await api<StaffSelfAttendanceData>('me/staff-attendance',token))
    } catch(e) {setError(e instanceof Error?e.message:'Unable to record your attendance.')}
    finally {setBusy(false)}
  }
  return <div className="academic-workspace"><section className="panel">
    <div className="panel-heading"><div><h2>My attendance</h2><p>Check in and out using your staff account. Your times are sent to the authorised attendance office.</p></div><button type="button" className="secondary-button" onClick={()=>void refresh()} disabled={loading||busy}>Refresh</button></div>
    {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<div className="success-notice" role="status">{notice}</div>}
    {loading&&!data&&<p className="form-hint">Loading your attendance...</p>}
    {data&&<>
      <div className="teacher-attendance-identity"><strong>{data.staff_name}</strong><span>{data.staff_number}</span></div>
      <div className="staff-self-checkin-card"><div><span>Today · {new Date(data.today.attendance_date+'T00:00:00').toLocaleDateString('en-UG',{day:'numeric',month:'long',year:'numeric'})}</span><strong>{data.today.status}</strong><small>Check in: {data.today.check_in_at?.slice(11,16)||'Not recorded'} · Check out: {data.today.check_out_at?.slice(11,16)||'Not recorded'}</small></div>
        {!data.today.check_in_at?<button type="button" className="primary-button" disabled={busy} onClick={()=>void act('check-in')}>{busy?'Submitting...':'Check in'}</button>:!data.today.check_out_at?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void act('check-out')}>{busy?'Submitting...':'Check out'}</button>:<span className="attendance-status-pill status-present">Day completed</span>}
      </div>
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Check in</th><th>Check out</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        {data.records.map(row=><tr key={row.id}><td>{new Date(row.attendance_date+'T00:00:00').toLocaleDateString('en-UG',{day:'numeric',month:'short',year:'numeric'})}</td><td>{row.check_in_at?.slice(11,16)||'—'}</td><td>{row.check_out_at?.slice(11,16)||'—'}</td><td><span className={'attendance-status-pill status-'+row.status.toLowerCase()}>{row.status}</span></td><td>{row.notes||'—'}</td></tr>)}
        {!data.records.length&&<tr><td colSpan={5}>No attendance records yet.</td></tr>}
      </tbody></table></div>
    </>}
  </section></div>
}

type TeacherAssignment = {assignment_id:number;class_id:number;class:string;subject_id:number;subject:string}
type TeacherStudent = {id:number;first_name:string;last_name:string;admission_number:string;class_id:number}
type TeacherExam = {id:number;name:string;term:string;year:number;class_id:number|null;assigned_subjects:{id:number;name:string}[]}
type TeacherMark = {id:number;student_id:number;subject_id:number;exam_id:number;score:number;verified:boolean;student_name:string;admission_number:string;class_id:number|null}
type TeacherResultStatus = {subject_id:number;submitted_count:number;pending_count:number;verified_count:number;status:'Not verified'|'Verified'|'Not submitted'}
type TeacherOfflineProposal = {id:number;exam_name:string;term:string;year:number|null;subject_name:string;status:string;record_count:number;submitted_at:string;resolved_at:string|null;resolution:string|null;conflict_sequence:number|null}
type TeacherOwnAttendance = {staff_name:string;staff_number:string;today:{attendance_date:string;status:string;check_in_at?:string|null;check_out_at?:string|null};records:{id:number;attendance_date:string;status:string;notes?:string|null;check_in_at?:string|null;check_out_at?:string|null}[]}
type ClassTeacherAssignment = {assignment_id:number;class_id:number;class:string}

function TeacherWorkspace({token,active,userId}:{token:string;active:string;userId:number}) {
  const [assignments,setAssignments]=useState<TeacherAssignment[]>([])
  const [classTeacherAssignments,setClassTeacherAssignments]=useState<ClassTeacherAssignment[]>([])
  const [students,setStudents]=useState<TeacherStudent[]>([])
  const [classId,setClassId]=useState('')
  const [statuses,setStatuses]=useState<Record<number,string>>({})
  const [attendanceDate,setAttendanceDate]=useState(new Date().toISOString().slice(0,10))
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState<number|null>(null)
  const [teacherExams,setTeacherExams]=useState<TeacherExam[]>([])
  const [activeTeacherExamType,setActiveTeacherExamType]=useState('All exams')
  const [selectedTeacherExamGroupKey,setSelectedTeacherExamGroupKey]=useState('')
  const [examId,setExamId]=useState('')
  const [resultStudents,setResultStudents]=useState<TeacherStudent[]>([])
  const [resultMarks,setResultMarks]=useState<TeacherMark[]>([])
  const [resultStatuses,setResultStatuses]=useState<TeacherResultStatus[]>([])
  const [selectedSubjectId,setSelectedSubjectId]=useState('')
  const [resultScores,setResultScores]=useState<Record<number,string>>({})
  const [resultMessage,setResultMessage]=useState('')
  const [resultError,setResultError]=useState('')
  const [resultSaving,setResultSaving]=useState(false)
  const [resultSubmissionComplete,setResultSubmissionComplete]=useState(false)
  const lastOfflineScoreContext=useRef('')
  const [offlinePassphrase,setOfflinePassphrase]=useState('')
  const [offlineDraftMessage,setOfflineDraftMessage]=useState('')
  const [offlineDraftBusy,setOfflineDraftBusy]=useState(false)
  const [offlineDraftUnlocked,setOfflineDraftUnlocked]=useState(false)
  const [teacherOfflineProposals,setTeacherOfflineProposals]=useState<TeacherOfflineProposal[]>([])
  const [teacherOfflineProposalsLoading,setTeacherOfflineProposalsLoading]=useState(false)
  const [teacherOfflineProposalsError,setTeacherOfflineProposalsError]=useState('')
  const [resultSnapshotSequence,setResultSnapshotSequence]=useState<number|null>(null)
  const [ownAttendance,setOwnAttendance]=useState<TeacherOwnAttendance|null>(null)
  const [ownAttendanceError,setOwnAttendanceError]=useState('')
  const [ownAttendanceLoading,setOwnAttendanceLoading]=useState(false)
  const [ownAttendanceActionBusy,setOwnAttendanceActionBusy]=useState(false)
  const [ownAttendanceNotice,setOwnAttendanceNotice]=useState('')

  useEffect(()=>{Promise.all([api<TeacherAssignment[]>('teacher/my-assignments',token),api<ClassTeacherAssignment[]>('teacher/my-class-teacher-assignments',token)]).then(([rows,classRows])=>{setAssignments(rows);setClassTeacherAssignments(classRows);if(classRows.length)setClassId(String(classRows[0].class_id))}).catch(e=>setMessage(e.message))},[token])
  useEffect(()=>{if(active!=='Attendance'||!classId)return;api<TeacherStudent[]>('teacher/students?class_id='+classId,token).then(setStudents).catch(e=>setMessage(e.message))},[active,classId,token])
  useEffect(()=>{
    if(active!=='My Results')return
    api<TeacherExam[]>('teacher/exams',token).then(rows=>{
      setTeacherExams(rows)
      if(rows.length){
        const first=rows[0]
        setActiveTeacherExamType('All exams')
        setSelectedTeacherExamGroupKey([first.name||'Other',first.term,first.year].join('|'))
        setExamId(String(first.id))
        setSelectedSubjectId(String(first.assigned_subjects?.[0]?.id||''))
        setResultSubmissionComplete(false)
      } else {setExamId('');setSelectedSubjectId('');setSelectedTeacherExamGroupKey('')}
    }).catch(e=>setResultError(e.message))
  },[active,token])
  useEffect(()=>{
    if(active!=='My Results')return
    void refreshTeacherOfflineProposals()
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId){setResultSnapshotSequence(null);return}
    api<{snapshot_sequence:number}>('sync/marks?device_id='+encodeURIComponent(deviceId)+'&limit=200',token)
      .then(result=>setResultSnapshotSequence(result.snapshot_sequence))
      .catch(()=>setResultSnapshotSequence(null))
  },[active,token,userId])
  useEffect(()=>{
    if(active!=='My Attendance')return
    let cancelled=false
    setOwnAttendanceLoading(true)
    setOwnAttendanceError('')
    api<TeacherOwnAttendance>('me/staff-attendance',token).then(data=>{
      if(!cancelled)setOwnAttendance(data)
    }).catch(error=>{
      if(!cancelled){setOwnAttendance(null);setOwnAttendanceError(error instanceof Error?error.message:'Unable to load your attendance records.')}
    }).finally(()=>{if(!cancelled)setOwnAttendanceLoading(false)})
    return ()=>{cancelled=true}
  },[active,token])
  async function updateOwnAttendance(action:'check-in'|'check-out') {
    setOwnAttendanceActionBusy(true); setOwnAttendanceNotice(''); setOwnAttendanceError('')
    try {
      const result = await api<{message:string}>(`me/staff-attendance/${action}`, token, { method: 'POST' })
      const latest = await api<TeacherOwnAttendance>('me/staff-attendance', token)
      setOwnAttendance(latest); setOwnAttendanceNotice(result.message)
    } catch (error) {
      setOwnAttendanceError(error instanceof Error ? error.message : 'Unable to update your attendance.')
    } finally { setOwnAttendanceActionBusy(false) }
  }
    const teacherExamTypes=['Beginning of Term','Mid-Term','End of Term','Mock','Promotional','Other']
  const teacherExamGroupKey=(exam:TeacherExam)=>[exam.name||'Other',exam.term,exam.year].join('|')
  const teacherExamCategories=['All exams',...teacherExamTypes]
  const visibleTeacherExams=teacherExams.filter(exam=>activeTeacherExamType==='All exams'||(teacherExamTypes.includes(exam.name)?exam.name:'Other')===activeTeacherExamType)
  const teacherExamGroups=Array.from(new Map(visibleTeacherExams.map(exam=>[teacherExamGroupKey(exam),exam])).values())
  const selectedTeacherExam=teacherExams.find(exam=>String(exam.id)===examId)||null
  const assignedSubjects=selectedTeacherExam?.assigned_subjects||[]
  const currentSubjectStatus=resultStatuses.find(row=>row.subject_id===Number(selectedSubjectId))
  const currentSubjectIsVerified=currentSubjectStatus?.status==='Verified'
  const currentSubjectSubmittedCount = currentSubjectStatus?.submitted_count ?? resultStudents.filter(student => resultMarks.some(mark => mark.student_id === student.id && mark.subject_id === Number(selectedSubjectId))).length
  const currentSubjectProgress = resultStudents.length ? Math.round(currentSubjectSubmittedCount / resultStudents.length * 100) : 0
  async function refreshTeacherResultStatus(){
    if(!selectedTeacherExam)return
    try{
      const [markRows,statusRows]=await Promise.all([
        api<TeacherMark[]>('teacher/marks?exam_id='+selectedTeacherExam.id,token),
        api<TeacherResultStatus[]>('teacher/result-status?exam_id='+selectedTeacherExam.id,token),
      ])
      setResultMarks(markRows);setResultStatuses(statusRows)
      const current=statusRows.find(row=>row.subject_id===Number(selectedSubjectId))
      if(current?.status==='Verified'){setResultStudents([]);setResultScores({});setResultSubmissionComplete(false);setResultMessage('These results have been verified. The student list is now locked and hidden from your account.')}
    }catch(error){setResultError(error instanceof Error?error.message:'Unable to refresh result status.')}
  }
  useEffect(()=>{
    if(active!=='My Results'||!selectedTeacherExam)return
    const refreshId=window.setInterval(()=>{void refreshTeacherResultStatus()},15000)
    return ()=>window.clearInterval(refreshId)
  },[active,examId,selectedSubjectId,token])
  useEffect(()=>{
    if(active!=='My Results'||!selectedTeacherExam){setResultStudents([]);setResultMarks([]);return}
    let cancelled=false
    setResultError('')
    Promise.all([
      api<TeacherStudent[]>('teacher/students?class_id='+selectedTeacherExam.class_id,token),
      api<TeacherMark[]>('teacher/marks?exam_id='+selectedTeacherExam.id,token),
      api<TeacherResultStatus[]>('teacher/result-status?exam_id='+selectedTeacherExam.id,token),
    ]).then(([studentRows,markRows,statusRows])=>{
      if(cancelled)return
      setResultStudents(studentRows)
      setResultMarks(markRows)
      setResultStatuses(statusRows)
    }).catch(e=>{if(!cancelled)setResultError(e.message)})
    return ()=>{cancelled=true}
  },[active,examId,selectedTeacherExam?.class_id,token])
  async function saveClassAttendance(){if(!classId||!students.length){setMessage('Choose a responsible class with active students.');return}setBusy(-1);setMessage('');try{const result=await api<{saved:number}>('attendance/register',token,{method:'PUT',body:JSON.stringify({class_id:Number(classId),attendance_date:attendanceDate,records:students.map(student=>({student_id:student.id,status:statuses[student.id]||'Present'}))})});setMessage(result.saved+' student attendance records saved for '+attendanceDate+'.')}catch(e){setMessage(e instanceof Error?e.message:'Unable to save class attendance.')}finally{setBusy(null)}}
  useEffect(()=>{const context=String(examId)+':'+String(selectedSubjectId);const changed=lastOfflineScoreContext.current!==context;lastOfflineScoreContext.current=context;if(!selectedSubjectId){setResultScores({});return}if(changed&&offlineDraftUnlocked)setOfflineDraftUnlocked(false);const preserveUnlockedDraft=offlineDraftUnlocked&&!changed;setResultScores(current=>{const next:Record<number,string>=changed?{}:{...current};resultStudents.forEach(student=>{const mark=resultMarks.find(row=>row.student_id===student.id&&row.subject_id===Number(selectedSubjectId));if(preserveUnlockedDraft){if(next[student.id]===undefined)next[student.id]=''}else if(mark)next[student.id]=String(mark.score);else if(next[student.id]===undefined)next[student.id]=''});return next})},[examId,selectedSubjectId,resultStudents,resultMarks,offlineDraftUnlocked])
  async function refreshTeacherOfflineProposals(){
    setTeacherOfflineProposalsLoading(true);setTeacherOfflineProposalsError('')
    try{
      const result=await api<{proposals:TeacherOfflineProposal[]}>('sync/teacher-mark-proposals/mine',token)
      setTeacherOfflineProposals(result.proposals)
    }catch(error){setTeacherOfflineProposalsError(error instanceof Error?error.message:'Unable to refresh offline submission status.')}
    finally{setTeacherOfflineProposalsLoading(false)}
  }
  async function saveOfflineTeacherMarksDraft(){
    if(!selectedTeacherExam||!selectedSubjectId||!resultStudents.length){setOfflineDraftMessage('Choose an examination, assigned subject and class register first.');return}
    if(currentSubjectIsVerified){setOfflineDraftMessage('These results are verified and locked. Ask the administrator to unlock them before saving changes.');return}
    if(!window.confirm('Save the current class scores as the encrypted offline draft? This replaces the previous saved draft on this browser, if one exists.'))return
    if(offlinePassphrase.trim().length<12){setOfflineDraftMessage('Use a strong offline passphrase of at least 12 characters. It is not stored by SchoolBridge.');return}
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId){setOfflineDraftMessage('Register this browser in Device Management before preparing an offline draft.');return}
    if(resultSnapshotSequence===null){setOfflineDraftMessage('Connect while online and refresh your results snapshot before saving an offline draft.');return}
    setOfflineDraftBusy(true);setOfflineDraftMessage('')
    try{
      const records=resultStudents.map(student=>({student_id:student.id,score:resultScores[student.id]===undefined||resultScores[student.id].trim()===''?0:Number(resultScores[student.id])}))
      if(records.some(row=>!Number.isFinite(row.score)||row.score<0||row.score>100)){throw new Error('Every score must be between 0 and 100.')}
      await saveEncryptedOfflineDraft(userId,deviceId,offlinePassphrase,{
        version:1,device_id:deviceId,idempotency_key:crypto.randomUUID(),
        exam:selectedTeacherExam,subject_id:Number(selectedSubjectId),base_sequence:resultSnapshotSequence,
        students:resultStudents.map(student=>({id:student.id,first_name:student.first_name,last_name:student.last_name,admission_number:student.admission_number,class_id:student.class_id})),scores:resultScores,records,
        base_mark_ids:Object.fromEntries(resultStudents.map(student=>[student.id,resultMarks.find(mark=>mark.student_id===student.id&&mark.subject_id===Number(selectedSubjectId))?.id??null])),
      },true)
      setOfflineDraftMessage('Encrypted offline draft saved on this browser. It has not changed official results.')
    }catch(error){setOfflineDraftMessage(error instanceof Error?error.message:'Unable to save the encrypted offline draft.')}
    finally{setOfflineDraftBusy(false)}
  }
  async function unlockOfflineTeacherMarksDraft(){
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId){setOfflineDraftMessage('This browser has no registered device identity.');return}
    if(offlinePassphrase.trim().length<12){setOfflineDraftMessage('Enter the 12-character-or-longer passphrase used when saving this draft.');return}
    setOfflineDraftBusy(true);setOfflineDraftMessage('')
    try{
      const draft=await loadEncryptedOfflineDraft<any>(userId,deviceId,offlinePassphrase)
      if(draft.version!==1||draft.device_id!==deviceId||!draft.exam||!Array.isArray(draft.students)||!Array.isArray(draft.records))throw new Error('The saved draft is not valid for this registered device.')
      setTeacherExams([draft.exam]);setExamId(String(draft.exam.id))
      setSelectedTeacherExamGroupKey([draft.exam.name||'Other',draft.exam.term,draft.exam.year].join('|'))
      setActiveTeacherExamType('All exams');lastOfflineScoreContext.current=String(draft.exam.id)+':'+String(draft.subject_id);setSelectedSubjectId(String(draft.subject_id))
      setResultStudents(draft.students);setResultScores(draft.scores||{});setOfflineDraftUnlocked(true)
      setResultSnapshotSequence(draft.base_sequence);setResultSubmissionComplete(false)
      setOfflineDraftMessage('Encrypted draft unlocked. Check the class and scores before submitting it when online.')
    }catch(error){setOfflineDraftMessage(error instanceof Error?error.message:'Unable to unlock the offline draft.')}
    finally{setOfflineDraftBusy(false)}
  }
  async function refreshOfflineTeacherMarksBaseline(){
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId||!selectedTeacherExam||!selectedSubjectId){setOfflineDraftMessage('Register this browser and choose an assigned examination and subject first.');return}
    setOfflineDraftBusy(true);setOfflineDraftMessage('')
    try{
      const [examRows,studentRows,markRows,statusRows,snapshot]=await Promise.all([
        api<TeacherExam[]>('teacher/exams',token),
        api<TeacherStudent[]>('teacher/students?class_id='+selectedTeacherExam.class_id,token),
        api<TeacherMark[]>('teacher/marks?exam_id='+selectedTeacherExam.id,token),
        api<TeacherResultStatus[]>('teacher/result-status?exam_id='+selectedTeacherExam.id,token),
        api<{snapshot_sequence:number}>('sync/marks?device_id='+encodeURIComponent(deviceId)+'&limit=200',token),
      ])
      const currentExam=examRows.find(row=>row.id===selectedTeacherExam.id)
      if(!currentExam||!currentExam.assigned_subjects.some(subject=>subject.id===Number(selectedSubjectId))){
        throw new Error('Your class or subject assignment has changed. This draft cannot be refreshed for submission.')
      }
      if(statusRows.some(row=>row.subject_id===Number(selectedSubjectId)&&row.status==='Verified')){
        throw new Error('These results are verified and locked. Ask the administrator to unlock them before making changes.')
      }
      setTeacherExams(examRows);setResultStudents(studentRows);setResultMarks(markRows);setResultStatuses(statusRows)
      setResultSnapshotSequence(snapshot.snapshot_sequence)
      setOfflineDraftMessage('Fresh server baseline loaded. Your unlocked scores were retained. Review them, then save a new encrypted draft before resubmitting.')
    }catch(error){setOfflineDraftMessage(error instanceof Error?error.message:'Unable to refresh the offline marks baseline.')}
    finally{setOfflineDraftBusy(false)}
  }
  async function submitOfflineTeacherMarksDraft(){
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId||offlinePassphrase.trim().length<12){setOfflineDraftMessage('Enter the offline passphrase and make sure this browser is registered.');return}
    setOfflineDraftBusy(true);setOfflineDraftMessage('')
    try{
      const draft=await loadEncryptedOfflineDraft<any>(userId,deviceId,offlinePassphrase)
      const currentDraftIsOpen=selectedTeacherExam?.id===draft.exam.id&&Number(selectedSubjectId)===draft.subject_id&&resultStudents.length>0
      if(!currentDraftIsOpen)throw new Error('Unlock the saved draft and check its scores before submitting it.')
      const currentRecords:{student_id:number;score:number}[]=resultStudents.map(student=>({student_id:student.id,score:resultScores[student.id]===undefined||resultScores[student.id].trim()===''?0:Number(resultScores[student.id])}))
      if(currentRecords.some(record=>!Number.isFinite(record.score)||record.score<0||record.score>100))throw new Error('Every score must be between 0 and 100.')
      const result=await api<{proposal_id:number;status:string;duplicate:boolean;applied:boolean;saved:number}>('sync/teacher-mark-proposals',token,{method:'POST',body:JSON.stringify({
        device_id:draft.device_id,idempotency_key:draft.idempotency_key,exam_id:draft.exam.id,
        subject_id:draft.subject_id,base_sequence:draft.base_sequence,base_mark_ids:draft.base_mark_ids||{},records:currentRecords,
      })})
      if(result.status==='conflict'||!result.applied){
        setOfflineDraftMessage('Proposal #'+result.proposal_id+' has a conflict. Your encrypted draft was kept. Refresh the baseline, review the retained scores, save a new encrypted draft, then submit again.')
        await refreshTeacherOfflineProposals()
      }else{
        await deleteEncryptedOfflineDraft(userId,deviceId)
        setOfflineDraftUnlocked(false)
        setOfflineDraftMessage(result.applied?'Offline marks #'+result.proposal_id+' were automatically applied by the system. '+(result.saved||0)+' marks were saved and remain unverified for normal academic verification.':'Offline marks #'+result.proposal_id+' were not applied because a conflict was detected. Your encrypted draft was kept. Refresh the baseline, review the scores, and save a new draft before resubmitting.')
        setOfflinePassphrase('')
        await refreshTeacherOfflineProposals()
      }
    }catch(error){setOfflineDraftMessage(error instanceof Error?error.message:'Unable to submit the saved draft.')}
    finally{setOfflineDraftBusy(false)}
  }
  async function saveTeacherMarksBulk(e:React.FormEvent){
    e.preventDefault()
    if(!selectedTeacherExam||!selectedSubjectId){setResultError('Choose an examination and one of your assigned subjects.');return}
    const noScoreCount=resultStudents.filter(student=>resultScores[student.id]===undefined||resultScores[student.id].trim()==='').length
    // A blank entry is an explicit "No score" and is submitted as zero.
    const records=resultStudents.map(student=>({student_id:student.id,score:resultScores[student.id]===undefined||resultScores[student.id].trim()===''?0:Number(resultScores[student.id])}))
    if(records.some(row=>!Number.isFinite(row.score)||row.score<0||row.score>100)){setResultError('Every score must be between 0 and 100.');return}
    setResultSaving(true);setResultError('');setResultMessage('')
    try{
      const result=await api<{saved:number;no_score?:number}>('teacher/marks/bulk',token,{method:'POST',body:JSON.stringify({exam_id:selectedTeacherExam.id,subject_id:Number(selectedSubjectId),records})})
      const rows=await api<TeacherMark[]>('teacher/marks?exam_id='+selectedTeacherExam.id,token)
      setResultMarks(rows);setResultMessage(result.saved+' results submitted for academic verification, including '+(result.no_score ?? noScoreCount)+' No score (0) entries.');setResultSubmissionComplete(true)
    }catch(e){setResultError(e instanceof Error?e.message:'Unable to submit class results.')}
    finally{setResultSaving(false)}
  }
  if(active==='My Classes') return <section className="panel"><div className="panel-heading"><div><h2>My assigned classes</h2><p>Only classes and subjects assigned to your teacher account appear here.</p></div></div>{message&&<div className="notice">{message}</div>}<h3>Subject teaching assignments</h3><div className="class-grid">{assignments.map(a=><div className="class-card" key={a.assignment_id}><BookOpen size={22}/><strong>{a.class}</strong><span>{a.subject}</span></div>)}</div>{!assignments.length&&<p className="form-hint">No subject and class combinations have been assigned to you yet.</p>}<h3>Class-teacher responsibilities</h3><div className="class-grid">{classTeacherAssignments.map(a=><div className="class-card" key={a.assignment_id}><Users size={22}/><strong>{a.class}</strong><span>Responsible for the full class register</span></div>)}</div>{!classTeacherAssignments.length&&<p className="form-hint">You are not currently assigned as a class teacher.</p>}</section>
  if(active==='My Attendance') return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>My attendance record</h2><p>Review the daily attendance status recorded against your staff profile.</p></div><button type="button" className="secondary-button" disabled={ownAttendanceLoading||ownAttendanceActionBusy} onClick={()=>{setOwnAttendanceLoading(true);api<TeacherOwnAttendance>('me/staff-attendance',token).then(setOwnAttendance).catch(e=>setOwnAttendanceError(e instanceof Error?e.message:'Unable to refresh attendance.')).finally(()=>setOwnAttendanceLoading(false))}}>Refresh status</button></div>
      {ownAttendanceLoading&&<p className="form-hint">Loading your attendance...</p>}
      {ownAttendanceError&&<div className="form-error" role="alert">{ownAttendanceError}</div>}
      {ownAttendance&&<>
        <div className="teacher-attendance-identity"><strong>{ownAttendance.staff_name}</strong><span>{ownAttendance.staff_number}</span></div>
        <div className="staff-self-checkin-card"><div><span>Today · {new Date(ownAttendance.today.attendance_date+'T00:00:00').toLocaleDateString('en-UG',{day:'numeric',month:'long',year:'numeric'})}</span><strong>{ownAttendance.today.status}</strong><small>Check in: {ownAttendance.today.check_in_at?.slice(11,16) || 'Not recorded'} · Check out: {ownAttendance.today.check_out_at?.slice(11,16) || 'Not recorded'}</small></div>
          {!ownAttendance.today.check_in_at ? <button type="button" className="primary-button" disabled={ownAttendanceActionBusy} onClick={()=>void updateOwnAttendance('check-in')}>{ownAttendanceActionBusy?'Submitting...':'Check in'}</button> : !ownAttendance.today.check_out_at ? <button type="button" className="secondary-button" disabled={ownAttendanceActionBusy} onClick={()=>void updateOwnAttendance('check-out')}>{ownAttendanceActionBusy?'Submitting...':'Check out'}</button> : <span className="attendance-status-pill status-present">Day completed</span>}
        </div>
        {ownAttendanceNotice&&<div className="success-notice" role="status">{ownAttendanceNotice}</div>}
        <p className="attendance-help">Your check-in and check-out times are sent to the authorised attendance office. The attendance administrator can review and correct the official status.</p>
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Check in</th><th>Check out</th><th>Your status</th><th>Notes</th></tr></thead><tbody>
          {ownAttendance.records.map(record=><tr key={record.id}><td>{new Date(record.attendance_date+'T00:00:00').toLocaleDateString('en-UG',{day:'numeric',month:'short',year:'numeric'})}</td><td>{record.check_in_at?.slice(11,16)||'—'}</td><td>{record.check_out_at?.slice(11,16)||'—'}</td><td><span className={'attendance-status-pill status-'+record.status.toLowerCase()}>{record.status}</span></td><td>{record.notes||'—'}</td></tr>)}
          {!ownAttendance.records.length&&<tr><td colSpan={5}>No attendance records have been saved against your staff profile yet.</td></tr>}
        </tbody></table></div>
      </>}
    </section>
  </div>
    if(active==='My Results') return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>Class results entry</h2><p>Your assigned subject and class are loaded automatically. Enter the whole class register and submit once. Blank scores are submitted as <strong>No score (0)</strong> for academic officers to review.</p></div>{selectedTeacherExam&&<button type="button" className="secondary-button" disabled={resultSaving} onClick={()=>void refreshTeacherResultStatus()}>Refresh status</button>}</div>
      {resultError&&<div className="form-error" role="alert">{resultError}</div>}
      {resultMessage&&<div className="success-notice" role="status">{resultMessage}</div>}
      <section className="offline-mark-draft-tools">
        <div><strong>Offline marks draft</strong><p className="form-hint">Prepare and save this class register while online. If the connection drops, unlock it with the same passphrase and continue editing. Save / update again before closing the browser, then unlock and submit for administrator review after reconnecting.</p></div>
        <label>Offline passphrase<input type="password" minLength={12} autoComplete="off" value={offlinePassphrase} onChange={event=>setOfflinePassphrase(event.target.value)} placeholder="At least 12 characters"/></label>
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={offlineDraftBusy||resultSaving||!selectedTeacherExam||!selectedSubjectId} onClick={()=>void refreshOfflineTeacherMarksBaseline()}>Refresh baseline online</button>
          <button type="button" className="secondary-button" disabled={offlineDraftBusy||resultSaving||!selectedTeacherExam||!selectedSubjectId} onClick={()=>void saveOfflineTeacherMarksDraft()}>{offlineDraftBusy?'Working...':'Save encrypted offline draft'}</button>
          <button type="button" className="secondary-button" disabled={offlineDraftBusy} onClick={()=>void unlockOfflineTeacherMarksDraft()}>Unlock saved draft</button>
          <button type="button" className="primary-button" disabled={offlineDraftBusy} onClick={()=>void submitOfflineTeacherMarksDraft()}>Submit saved draft when online</button>
        </div>
        {offlineDraftMessage&&<div className="form-hint" role="status">{offlineDraftMessage}</div>}
        <p className="form-hint">{resultSnapshotSequence===null?'No current sync baseline is available. Connect online and refresh your results first.':'Offline baseline sequence: '+resultSnapshotSequence}</p>
      </section>
      <section className="offline-mark-proposal-status">
        <div className="panel-heading"><div><h3>Your offline submissions</h3><p className="form-hint">Track administrator review without exposing the submitted score payload again.</p></div><button type="button" className="secondary-button" disabled={teacherOfflineProposalsLoading} onClick={()=>void refreshTeacherOfflineProposals()}>{teacherOfflineProposalsLoading?'Refreshing...':'Refresh status'}</button></div>
        {teacherOfflineProposalsError&&<div className="form-error" role="alert">{teacherOfflineProposalsError}</div>}
        {teacherOfflineProposalsLoading&&!teacherOfflineProposals.length?<p className="form-hint">Loading submission status...</p>:!teacherOfflineProposals.length?<p className="empty-state">You have not submitted any offline marks yet.</p>:<div className="table-wrap"><table><thead><tr><th>Examination</th><th>Subject</th><th>Entries</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
          {teacherOfflineProposals.map(item=><tr key={item.id}>
            <td>{item.exam_name}<small className="form-hint">{item.term} {item.year||''} · Proposal #{item.id}</small></td>
            <td>{item.subject_name}</td>
            <td>{item.record_count}</td>
            <td>{item.status==='pending_review'?'Waiting for administrator':item.status==='conflict'?'Conflict — refresh and resubmit':item.status==='applied'?'Applied — awaiting academic verification':item.status==='rejected'?'Rejected':item.status==='discarded'?'Discarded':item.status}</td>
            <td>{item.submitted_at?new Date(item.submitted_at+(item.submitted_at.endsWith('Z')?'':'Z')).toLocaleString():'—'}</td>
          </tr>)}
        </tbody></table></div>}
      </section>
      <div className="teacher-exam-selection">
         <div className="exam-flow-step"><span className="form-section-number">01</span><div><strong>Choose exam type</strong><small>Choose the category used by the school examination register.</small></div></div>
         <nav className="exam-type-tabs" aria-label="Examination types">{teacherExamCategories.map(type=><button type="button" key={type} className={activeTeacherExamType===type?'exam-type-tab active':'exam-type-tab'} aria-pressed={activeTeacherExamType===type} onClick={()=>{setActiveTeacherExamType(type);setSelectedTeacherExamGroupKey('');setExamId('');setSelectedSubjectId('');setResultSubmissionComplete(false)}}>{type}</button>)}</nav>
         <div className="exam-flow-step"><span className="form-section-number">02</span><div><strong>Choose examination</strong><small>Select the term and academic year.</small></div></div>
         <div className="exam-choice-grid">{teacherExamGroups.map(exam=>{const key=teacherExamGroupKey(exam);return <button type="button" key={key} className={selectedTeacherExamGroupKey===key?'exam-choice active':'exam-choice'} aria-pressed={selectedTeacherExamGroupKey===key} onClick={()=>{setSelectedTeacherExamGroupKey(key);setExamId('');setSelectedSubjectId('');setResultSubmissionComplete(false)}}><strong>{teacherExamTypes.includes(exam.name)?exam.name:'Other'}</strong><span>{exam.term} · {exam.year}</span><small>{visibleTeacherExams.filter(row=>teacherExamGroupKey(row)===key).length} assigned class(es)</small></button>})}{!teacherExamGroups.length&&<p className="form-hint">No examinations are available under this category for your assigned classes and subjects.</p>}</div>
         {selectedTeacherExamGroupKey&&<><div className="exam-flow-step"><span className="form-section-number">03</span><div><strong>Choose class</strong><small>Open the assigned class examination.</small></div></div><div className="exam-class-choices">{teacherExams.filter(exam=>teacherExamGroupKey(exam)===selectedTeacherExamGroupKey).map(exam=><button type="button" key={exam.id} className={examId===String(exam.id)?'exam-class-choice active':'exam-class-choice'} aria-pressed={examId===String(exam.id)} onClick={()=>{setExamId(String(exam.id));setSelectedSubjectId(String(exam.assigned_subjects?.[0]?.id||''));setResultSubmissionComplete(false)}}>{assignments.find(row=>row.class_id===exam.class_id)?.class||'Assigned class'}</button>)}</div></>}
         {selectedTeacherExam&&<><div className="exam-flow-step"><span className="form-section-number">04</span><div><strong>Choose assigned subject</strong><small>Only subjects assigned to you for this examination are shown.</small></div></div><div className="subject-choice-options">{assignedSubjects.map(subject=>{const status=resultStatuses.find(row=>row.subject_id===subject.id)?.status||'Not submitted';return <button type="button" key={subject.id} className={selectedSubjectId===String(subject.id)?'exam-pill active':'exam-pill'} aria-pressed={selectedSubjectId===String(subject.id)} onClick={()=>{setSelectedSubjectId(String(subject.id));setResultSubmissionComplete(false)}}>{subject.name} · {status}</button>})}</div></>}
       </div>
      {selectedTeacherExam&&<p className="form-hint">Class: {assignments.find(row=>row.class_id===selectedTeacherExam.class_id)?.class || 'Assigned class'} · {currentSubjectStatus?.status||'Not submitted'}</p>}
      {currentSubjectIsVerified&&<section className="teacher-results-complete verified-results-lock" role="status"><div className="teacher-results-complete-icon">✓</div><h3>Results verified and locked</h3><p>The academic officer has verified this subject's results. The student list and individual scores are no longer available in your teacher account.</p><span className="student-score-status verified">Verified</span></section>}
      {!teacherExams.length&&<p className="form-hint">No examinations are available for your assigned subject and class combinations.</p>}
      {selectedTeacherExam&&selectedSubjectId&&<>
        <div className="teacher-results-progress">
          <div><strong>Submission progress</strong><span>{currentSubjectSubmittedCount} of {resultStudents.length} student records submitted · {currentSubjectProgress}%</span></div>
          <div className="teacher-results-progress-track"><span style={{width:(resultSaving?Math.max(currentSubjectProgress,65):currentSubjectProgress)+'%'}}/></div>
        </div>
        {currentSubjectIsVerified ? null : resultSubmissionComplete ? <section className="teacher-results-complete" role="status">
          <div className="teacher-results-complete-icon">✓</div><h3>Class results submitted</h3>
          <p>{resultStudents.length} student records for {assignedSubjects.find(subject=>String(subject.id)===selectedSubjectId)?.name || 'this subject'} have been sent to the academic officers.</p>
          <span className="student-score-status recorded">Not verified</span>
          <p className="form-hint">The academic officer will review these results. After verification, the student list will close and the subject will be labelled Verified.</p>
          <button type="button" className="secondary-button" onClick={()=>{const next=assignedSubjects.find(subject=>String(subject.id)!==selectedSubjectId&&!resultMarks.some(mark=>mark.subject_id===subject.id));if(next)setSelectedSubjectId(String(next.id));setResultSubmissionComplete(false)}}>Continue to another subject / review scores</button>
        </section> : <form className="student-form" onSubmit={saveTeacherMarksBulk}>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>Student</th><th>Admission number</th><th>Score (0–100)</th><th>Status</th></tr></thead><tbody>
            {resultStudents.map((student,index)=>{const mark=resultMarks.find(row=>row.student_id===student.id&&row.subject_id===Number(selectedSubjectId));return <tr key={student.id}><td>{index+1}</td><td>{student.first_name} {student.last_name}</td><td>{student.admission_number}</td><td><input aria-label={'Score for '+student.first_name+' '+student.last_name} type="number" min="0" max="100" step="0.01" required value={resultScores[student.id]??''} disabled={Boolean(mark?.verified)} onChange={e=>setResultScores(old=>({...old,[student.id]:e.target.value}))}/></td><td>{mark?'Not verified':'Not submitted'}</td></tr>})}
            {!resultStudents.length&&<tr><td colSpan={5}>No active students are registered in this class.</td></tr>}
          </tbody></table></div>
          <div className="form-actions"><button className="primary-button" disabled={resultSaving||!resultStudents.length}>{resultSaving?'Submitting class results...':'Submit all class results'}</button></div>
        </form>}
      </>}
    </section>
  </div>
  return <section className="panel teacher-class-attendance"><div className="panel-heading"><div><h2>Class attendance</h2><p>Mark the whole class register and submit it once. Only your separately assigned class-teacher responsibilities appear here.</p></div></div>{message&&<div className="notice">{message}</div>}<div className="teacher-attendance-controls"><div><strong>Choose your responsible class</strong><div className="teacher-class-picks">{classTeacherAssignments.map(a=><button type="button" key={a.assignment_id} className={String(classId)===String(a.class_id)?"teacher-class-pick active":"teacher-class-pick"} aria-pressed={String(classId)===String(a.class_id)} onClick={()=>{setClassId(String(a.class_id));setStatuses({})}}>{a.class}</button>)}</div></div><label className="teacher-attendance-date">Attendance date<input type="date" value={attendanceDate} onChange={e=>setAttendanceDate(e.target.value)}/></label></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Student</th><th>Admission number</th><th>Status</th></tr></thead><tbody>{students.map((student,index)=><tr key={student.id}><td>{index+1}</td><td>{student.first_name} {student.last_name}</td><td>{student.admission_number}</td><td><div className="attendance-choice-group" role="group" aria-label={"Attendance status for "+student.first_name+" "+student.last_name}>{["Present","Absent","Late","Excused"].map(status=><button type="button" key={status} className={(statuses[student.id]||"Present")===status?"attendance-choice active status-"+status.toLowerCase():"attendance-choice"} aria-pressed={(statuses[student.id]||"Present")===status} onClick={()=>setStatuses(old=>({...old,[student.id]:status}))}>{status}</button>)}</div></td></tr>)}</tbody></table></div>{students.length>0&&<div className="form-actions"><button type="button" className="primary-button" disabled={busy!==null} onClick={()=>void saveClassAttendance()}>{busy!==null?'Saving register...':'Submit class attendance'}</button></div>}{!students.length&&<div className="empty-state"><Users size={30}/><p>{classTeacherAssignments.length?'Choose one of your assigned classes to load its active students.':'No class has been assigned to you as class teacher. Subject teaching assignments do not grant class attendance access.'}</p></div>}</section>
}

type CommunityStudent = {id:number;name:string;admission_number:string;class_name:string;study_mode:string;house:string|null;photo_data?:string|null;member_type:string}
type CommunityStaff = {id:number;name:string;staff_number:string;position:string;house:string|null;photo_data?:string|null;member_type:string}
function SchoolCommunityWorkspace({token}:{token:string}) {
  const [data,setData]=useState<{houses:string[];students:CommunityStudent[];staff:CommunityStaff[]}>({houses:[],students:[],staff:[]})
  const [tab,setTab]=useState('All members')
  const [search,setSearch]=useState('')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refresh,setRefresh]=useState(0)
  const [sortBy,setSortBy]=useState<'name'|'class'|'house'|'category'>('name')
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    api<{houses:string[];students:CommunityStudent[];staff:CommunityStaff[]}>('school-community',token)
      .then(result=>{if(!cancelled)setData(result)})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Unable to load the school community.')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[token,refresh])
  const all=[...data.students,...data.staff]
  const tabs=['All members',...data.houses.map(h=>'House: '+h),'Day students','Boarding students','Staff']
  const filtered=all.filter(member=>{
    if(tab.startsWith('House: ')&&member.house!==tab.slice(7))return false
    if(tab==='Day students'&&(!('study_mode' in member)||member.study_mode!=='Day'))return false
    if(tab==='Boarding students'&&(!('study_mode' in member)||member.study_mode!=='Boarding'))return false
    if(tab==='Staff'&&member.member_type!=='Staff')return false
    const q=search.trim().toLowerCase()
    return !q||[member.name,member.member_type,member.house||'',('class_name' in member?member.class_name:''),('admission_number' in member?member.admission_number:''),('staff_number' in member?member.staff_number:''),('position' in member?member.position:'')].join(' ').toLowerCase().includes(q)
  })
  const sorted=[...filtered].sort((left,right)=>{
    const value=(member:CommunityStudent|CommunityStaff)=>sortBy==='house'?(member.house||''):sortBy==='category'?member.member_type:sortBy==='class'?('class_name' in member?member.class_name:member.position):member.name
    return value(left).localeCompare(value(right),undefined,{numeric:true,sensitivity:'base'})
  })
  return <section className="panel school-community-workspace">
    <div className="panel-heading"><div><h2>School Community</h2><p>Explore enrolled learners and active staff by house, study arrangement or membership type.</p></div><div className="community-actions"><button type="button" className="secondary-button" onClick={()=>window.print()} disabled={loading}>Print directory</button><button type="button" className="secondary-button" onClick={()=>setRefresh(v=>v+1)} disabled={loading}><RefreshCw size={15}/>{loading?'Refreshing...':'Refresh'}</button></div></div>
    <div className="community-summary-grid"><div><span className="community-summary-icon"><Users size={18}/></span><div><small>ALL MEMBERS</small><strong>{all.length}</strong></div></div><div><span className="community-summary-icon"><GraduationCap size={18}/></span><div><small>STUDENTS</small><strong>{data.students.length}</strong></div></div><div><span className="community-summary-icon"><Briefcase size={18}/></span><div><small>STAFF</small><strong>{data.staff.length}</strong></div></div><div><span className="community-summary-icon"><ShieldCheck size={18}/></span><div><small>HOUSES</small><strong>{data.houses.length}</strong></div></div></div>
    <div className="community-toolbar"><label className="community-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, admission number, class or house"/></label><label className="community-sort">Sort by<select value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)}><option value="name">Name</option><option value="class">Class / position</option><option value="house">House</option><option value="category">Category</option></select></label><span className="community-result-count">{filtered.length} members shown</span></div>
    <div className="community-tabs" role="tablist" aria-label="School community categories">{tabs.map(item=><button key={item} type="button" role="tab" aria-selected={tab===item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {loading?<div className="empty-state"><LoaderCircle className="spin" size={25}/><p>Loading school community...</p></div>:filtered.length?<div className="table-wrap community-table"><table><thead><tr><th>Member</th><th>Category</th><th>Class / Position</th><th>Study mode</th><th>House</th><th>Reference</th></tr></thead><tbody>{sorted.map(member=><tr key={member.member_type+'-'+member.id}><td><div className="student-cell"><div className="student-avatar">{member.photo_data?<img src={member.photo_data} alt=""/>:member.name.slice(0,1).toUpperCase()}</div><strong>{member.name}</strong></div></td><td><span className={'community-member-type '+member.member_type.toLowerCase()}>{member.member_type}</span></td><td>{'class_name' in member?member.class_name:member.position}</td><td>{'study_mode' in member?member.study_mode:'—'}</td><td>{member.house||'Unassigned'}</td><td>{'admission_number' in member?member.admission_number:member.staff_number}</td></tr>)}</tbody></table></div>:<div className="empty-state"><Users size={27}/><p>No members match this community view.</p><small>Try another category or search term.</small></div>}
  </section>
}

function SchoolProfileSettings({token,onSaved}:{token:string;onSaved:()=>void}) {
  const [profileTab,setProfileTab]=useState<'identity'|'contact'|'houses'|'branding'>('identity')
  const [form,setForm]=useState({name:'',address:'',phone:'',email:'',motto:'',school_type:'Secondary',country:'',school_structure:'',a_level_combinations:'',o_level_optional_subjects:'',a_level_subsidiary_subjects:'',report_logo:'',house_names:''})
  const [identityLocked,setIdentityLocked]=useState(false)
  const [correctionLicense,setCorrectionLicense]=useState('')
  const [correctionBusy,setCorrectionBusy]=useState(false)
  const [profileReload,setProfileReload]=useState(0)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [loaded,setLoaded]=useState(false)

  useEffect(()=>{
    api<any>('setup/status',token).then(s=>setIdentityLocked(Boolean(s.identity_locked))).catch(()=>{})
  },[token])

  useEffect(()=>{
    let cancelled=false
    api<any>('settings/school-profile',token).then(p=>{
      if(cancelled)return
      setForm({
        name:p.name||'',address:p.address||'',phone:p.phone||'',email:p.email||'',house_names:p.house_names||'',
        motto:p.motto||'',school_type:p.school_type||'Secondary',
        country:p.country||'',school_structure:p.school_structure||'',
        a_level_combinations:p.a_level_combinations||'',
        o_level_optional_subjects:p.o_level_optional_subjects||'',
        a_level_subsidiary_subjects:p.a_level_subsidiary_subjects||'',report_logo:p.report_logo||''
      })
      setLoaded(true)
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Unable to load school profile.')})
    return ()=>{cancelled=true}
  },[token,profileReload])

  async function applyIdentityCorrection(){
    if(correctionLicense.trim().length<20)return
    setCorrectionBusy(true);setError('');setMessage('')
    try{
      await api('setup/identity-correction',token,{method:'POST',body:JSON.stringify({license:correctionLicense.trim()})})
      setCorrectionLicense('')
      setIdentityLocked(true)
      setMessage('Owner-authorised school identity correction applied.')
      setProfileReload(value=>value+1)
      onSaved()
    }catch(e){setError(e instanceof Error?e.message:'Unable to apply the owner correction license.')}
    finally{setCorrectionBusy(false)}
  }

  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault()
    const name=form.name.trim()
    const email=form.email.trim()
    if(!name){setError('Enter the official school name before saving.');return}
    if(email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){setError('Enter a valid school email address.');return}
    setBusy(true);setError('');setMessage('')
    try{
      await api('settings/school-profile',token,{method:'PUT',body:JSON.stringify({
        ...form,name,address:form.address.trim()||null,phone:form.phone.trim()||null,
        email:email||null,motto:form.motto.trim()||null,report_logo:form.report_logo||null,house_names:form.house_names.split(/\r?\n/).map((h:string)=>h.trim()).filter(Boolean).join('\n')||null
      })})
      setMessage('School profile saved successfully.')
      setIdentityLocked(true)
      onSaved()
    }catch(e){setError(e instanceof Error?e.message:'Unable to save school profile.')}
    finally{setBusy(false)}
  }

  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>School profile</h2><p>Maintain the official identity and contact details used throughout SchoolBridge.</p></div></div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {message&&<div className="success-notice" role="status">{message}</div>}
    {!loaded&&!error&&<p className="form-hint">Loading saved school details...</p>}
    <form className="student-form" onSubmit={save}>
      <div className="settings-section-tabs" role="tablist" aria-label="School profile sections"><button type="button" role="tab" aria-selected={profileTab==='identity'} className={profileTab==='identity'?'active':''} onClick={()=>setProfileTab('identity')}>Identity</button><button type="button" role="tab" aria-selected={profileTab==='contact'} className={profileTab==='contact'?'active':''} onClick={()=>setProfileTab('contact')}>Contact</button><button type="button" role="tab" aria-selected={profileTab==='houses'} className={profileTab==='houses'?'active':''} onClick={()=>setProfileTab('houses')}>Houses</button><button type="button" role="tab" aria-selected={profileTab==='branding'} className={profileTab==='branding'?'active':''} onClick={()=>setProfileTab('branding')}>Branding</button></div>
      <div className="form-section" style={{display:profileTab==='identity'?'block':'none'}}>
        <div className="form-section-heading"><span className="form-section-number">01</span><div><h4>School identity</h4><p>These details identify your institution in the school workspace.</p></div></div>
        <div className="student-form-grid">
          {identityLocked&&<p className="form-hint field-span-full">The official school identity was recorded during first-time setup and is now protected. Contact the SchoolBridge owner for an authorised correction.</p>}
          <label className="field-span-full">Official school name *<input required disabled={identityLocked} maxLength={160} autoComplete="organization" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Enter the registered school name"/></label>
          <label>School type *<select required disabled={identityLocked} value={form.school_type} onChange={e=>setForm({...form,school_type:e.target.value})}><option value="Primary">Primary</option><option value="Secondary">Secondary</option><option value="Combined">Combined</option></select><small className="field-hint">This controls the class options and academic levels used during student registration.</small></label>
          <label>Country *<input required disabled={identityLocked} maxLength={80} value={form.country} onChange={e=>setForm({...form,country:e.target.value})} placeholder="Country"/></label>
          <label>School structure<select disabled={identityLocked} value={form.school_structure} onChange={e=>setForm({...form,school_structure:e.target.value})}><option value="">Not specified</option><option>Day</option><option>Boarding</option><option>Both</option></select></label>
          <label>School motto<input maxLength={200} value={form.motto} onChange={e=>setForm({...form,motto:e.target.value})} placeholder="Enter the school motto (optional)"/></label>
          {identityLocked&&<div className="owner-correction-panel field-span-full"><strong>Owner-authorised identity correction</strong><p>For a legitimate legal or structural change, obtain a one-time signed correction license from the SchoolBridge owner and paste it here.</p><textarea rows={3} value={correctionLicense} onChange={e=>setCorrectionLicense(e.target.value)} placeholder="Paste the owner-signed correction license"/><button type="button" className="secondary-button" disabled={correctionBusy||correctionLicense.trim().length<20} onClick={()=>void applyIdentityCorrection()}>{correctionBusy?'Verifying owner authorisation...':'Apply authorised correction'}</button></div>}
        </div>
      </div>
      <div className="form-section" style={{display:profileTab==='contact'?'block':'none'}}>
        <div className="form-section-heading"><span className="form-section-number">02</span><div><h4>Contact information</h4><p>Optional details that parents and authorised users can use to contact the school.</p></div></div>
        <div className="student-form-grid">
          <label>Phone number<input type="tel" autoComplete="tel" maxLength={30} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="e.g. 0700 000 000"/></label>
          <label>Email address<input type="email" autoComplete="email" maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="e.g. info@school.ug"/></label>
          <label className="field-span-full">Physical address<input autoComplete="street-address" maxLength={240} value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="Village, town, district or P.O. Box (optional)"/></label>
        </div>
      </div>
      <div className="form-section" style={{display:profileTab==='houses'?'block':'none'}}>
        <div className="form-section-heading"><span className="form-section-number">03</span><div><h4>House system</h4><p>Create the houses used to classify students and staff. Enter one house name per line.</p></div></div><label className="field-span-full">School houses<textarea rows={5} value={form.house_names} onChange={e=>setForm({...form,house_names:e.target.value})} placeholder={'e.g. Griffin\nPhoenix\nEagle\nLion'}/><small className="field-hint">House options appear in student and staff registration. Administrators are excluded from staff house assignment.</small></label>
      </div>
      <div className="form-section" style={{display:profileTab==='branding'?'block':'none'}}>
        <div className="form-section-heading"><span className="form-section-number">04</span><div><h4>School logo</h4><p>This logo appears beside the school name on printed student reports.</p></div></div>
        <label className="file-upload-button"><span>{form.report_logo ? 'Replace school logo' : 'Choose school logo'}</span><input type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){setError('Choose an image file.');return}if(file.size>1400000){setError('School logo must be 1.4 MB or smaller.');return}const reader=new FileReader();reader.onload=()=>setForm(current=>({...current,report_logo:String(reader.result||'')}));reader.onerror=()=>setError('Unable to read the selected logo.');reader.readAsDataURL(file)}}/></label>
        {form.report_logo && <div className="school-logo-settings-preview"><img src={form.report_logo} alt="School logo preview"/><button type="button" className="secondary-button" onClick={()=>setForm(current=>({...current,report_logo:''}))}>Remove logo</button></div>}
      </div>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={onSaved}>Cancel</button><button className="primary-button" disabled={busy||!loaded}>{busy?'Saving school profile...':'Save school profile'}</button></div>
      <p className="form-hint">Official identity fields are protected after setup. Contact details, motto, houses and branding can be updated by authorised administrators.</p>
    </form>
  </section>
}
function AcademicCurriculumSettings({token,onSaved}:{token:string;onSaved:()=>void}) {
  const [profile,setProfile]=useState<any>({name:'My School',school_type:'Secondary'})
  const [form,setForm]=useState({arts_combinations:'',sciences_combinations:'',o_level_optional_subjects:'',a_level_subsidiary_subjects:''})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api<any>('settings/school-profile',token).then(p=>{setProfile(p);setForm({arts_combinations:(p.a_level_combinations||'').split(/\r?\n/).filter((x:string)=>x.startsWith('ARTS::')).map((x:string)=>x.slice(6)).join('\n'),sciences_combinations:(p.a_level_combinations||'').split(/\r?\n/).filter((x:string)=>x.startsWith('SCIENCES::')).map((x:string)=>x.slice(10)).join('\n'),o_level_optional_subjects:p.o_level_optional_subjects||'',a_level_subsidiary_subjects:p.a_level_subsidiary_subjects||''})}).catch(e=>setMessage(e.message))},[token])
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('settings/school-profile',token,{method:'PUT',body:JSON.stringify({...profile,a_level_combinations:[...form.arts_combinations.split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean).map((x:string)=>'ARTS::'+x),...form.sciences_combinations.split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean).map((x:string)=>'SCIENCES::'+x)].join('\n'),o_level_optional_subjects:form.o_level_optional_subjects,a_level_subsidiary_subjects:form.a_level_subsidiary_subjects})});setMessage('Academic curriculum options saved.');onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to save curriculum settings.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Academic & curriculum settings</h2><p>Enter one option per line. These choices will appear during student registration.</p></div></div>{message&&<div className="success-notice">{message}</div>}<form className="student-form" onSubmit={save}><div className="student-form-grid"><label>A-Level Arts combinations<textarea rows={6} value={form.arts_combinations} onChange={e=>setForm({...form,arts_combinations:e.target.value})} placeholder={'e.g. HEG\nLEG\nHED'}/><small className="field-hint">Enter Arts combinations, one per line.</small></label><label>A-Level Sciences combinations<textarea rows={6} value={form.sciences_combinations} onChange={e=>setForm({...form,sciences_combinations:e.target.value})} placeholder={'e.g. PCM\nBCM\nPCB'}/><small className="field-hint">Enter Sciences combinations, one per line.</small></label><label className="field-span-full">O-Level optional subjects<textarea rows={6} value={form.o_level_optional_subjects} onChange={e=>setForm({...form,o_level_optional_subjects:e.target.value})} placeholder={'e.g. Agriculture\nComputer Studies\nFine Art'}/></label><label className="field-span-full">A-Level subsidiary subjects<textarea rows={4} value={form.a_level_subsidiary_subjects} onChange={e=>setForm({...form,a_level_subsidiary_subjects:e.target.value})} placeholder={'e.g. General Paper\nSub Mathematics'}/></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save academic options'}</button></div></form></section>
}

function TeacherUsersSettings({token,classes,onSaved}:{token:string;classes:RecordItem[];onSaved:()=>void}) {
  const [users,setUsers]=useState<any[]>([])
  const [staff,setStaff]=useState<any[]>([])
  const [subjects,setSubjects]=useState<any[]>([])
  const [catalog,setCatalog]=useState<any>({sections:[],presets:{}})
  const [assignment,setAssignment]=useState({teacher_id:'',class_id:'',subject_id:''})
  const [classTeacherAssignments,setClassTeacherAssignments]=useState<any[]>([])
  const [classTeacherForm,setClassTeacherForm]=useState({teacher_id:'',class_id:''})
  const [selectedId,setSelectedId]=useState('')
  const [roleLabel,setRoleLabel]=useState('')
  const [roleType,setRoleType]=useState<'teacher'|'staff'>('staff')
  const [permissions,setPermissions]=useState<Record<string,string[]>>({})
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [resetPasscode,setResetPasscode]=useState<{username:string;password:string}|null>(null)
  const [staffLoginSearch,setStaffLoginSearch]=useState('')
  const [otherLoginSearch,setOtherLoginSearch]=useState('')
  const [accountTab,setAccountTab]=useState<'access'|'assignments'|'staff'|'other'>('staff')
  async function load() {
    setLoading(true);setError('')
    try {
      const [u,st,sub,permissionData,classTeacherRows]=await Promise.all([
        api<any[]>('auth/users',token),api<any>('staff?page=1&page_size=100',token),api<any[]>('subjects',token),api<any>('auth/permissions',token),api<any[]>('class-teacher-assignments',token)
      ])
      setUsers(u);setStaff(st.items||[]);setSubjects(sub);setCatalog(permissionData);setClassTeacherAssignments(classTeacherRows)
      const first=u.find((item:any)=>item.role!=='admin'&&item.role!=='parent')
      if(first&&!selectedId){setSelectedId(String(first.id));setRoleLabel(first.role_label||first.role);setRoleType(first.role==='teacher'?'teacher':'staff');setPermissions(first.permissions||{})}
    } catch(e) {setError(e instanceof Error?e.message:'Unable to load staff accounts.')}
    finally {setLoading(false)}
  }
  useEffect(()=>{void load()},[token])
  function selectAccount(id:string) {
    setSelectedId(id);setResetPasscode(null)
    const item=users.find(u=>String(u.id)===id)
    if(item){setRoleLabel(item.role_label||item.role);setRoleType(item.role==='teacher'?'teacher':'staff');setPermissions(item.permissions||{})}
  }
  function applyPreset(label:string) {
    const sections=catalog.presets?.[label]||[]
    const next:Record<string,string[]>={}
    sections.forEach((section:string)=>{next[section]=['view']})
    if(label==='Teacher'||label==='Class Teacher') {
      if(label==='Class Teacher') next['Attendance']=['view','add','edit']
      next['My Classes']=['view'];next['My Attendance']=['view'];next['My Results']=['view','add','edit'];next['Announcements']=['view'];delete next['Timetable']
    }
    if(['Academic Administrator','Academics Officer','DOS'].includes(label)) {
      next['Timetable']=['view','add','edit','delete']
      next['Examinations']=['view','add','edit','approve']
    }
    if(label==='Attendance Officer'){next['Attendance']=['view','add','edit'];next['Staff Attendance']=['view','add','edit']}
    setRoleLabel(label);setRoleType(label==='Teacher'||label==='Class Teacher'?'teacher':'staff');setPermissions(next)
  }
  const permissionActions=['view','add','edit','delete','approve','print']
  function toggleSection(section:string) {
    setPermissions(current=>{
      const next={...current}
      if(next[section]?.includes('view')) delete next[section]
      else next[section]=[...permissionActions]
      return next
    })
  }
  function togglePermissionAction(section:string,action:string) {
    setPermissions(current=>{
      const updated={...current}
      const actions=new Set(updated[section]||[])
      if(actions.has(action)) actions.delete(action); else actions.add(action)
      if(actions.size) { actions.add('view'); updated[section]=[...actions] }
      else delete updated[section]
      return updated
    })
  }
  async function savePermissions() {
    if(!selectedId||roleLabel.trim().length<2){setError('Choose a staff account and enter a clear job role.');return}
    setBusy(true);setError('');setMessage('')
    try {
      await api('auth/users/'+selectedId+'/permissions',token,{method:'PUT',body:JSON.stringify({role:roleType,role_label:roleLabel.trim(),permissions})})
      setMessage('Staff access settings saved. The staff member should sign in again to refresh their access.')
      await load();onSaved()
    } catch(e) {setError(e instanceof Error?e.message:'Unable to save staff access settings.')}
    finally {setBusy(false)}
  }
  async function resetSelectedPassword() { if(!selectedId)return; const account=users.find(u=>String(u.id)===selectedId); await resetAccountPassword(selectedId,account?.username||'staff account') }
  async function resetAccountPassword(id:string,username:string) {
    if(!window.confirm('Issue a new temporary password for '+username+'? The existing password will stop working immediately.'))return
    setBusy(true);setError('');setMessage('');setResetPasscode(null)
    try {
      const result=await api<{username:string;temporary_password:string;message:string}>('auth/users/'+id+'/reset-password',token,{method:'POST'})
      setResetPasscode({username:result.username||username,password:result.temporary_password})
      setMessage(result.message||'Temporary password generated. Share it privately.')
    } catch(e) {setError(e instanceof Error?e.message:'Unable to reset this staff password.')}
    finally {setBusy(false)}
  }
  async function assignClassTeacher(e:React.FormEvent) {
    e.preventDefault()
    if(!classTeacherForm.teacher_id||!classTeacherForm.class_id){setError('Select a teacher and class for class-teacher responsibility.');return}
    setBusy(true);setError('');setMessage('')
    try {
      await api('class-teacher-assignments',token,{method:'POST',body:JSON.stringify({teacher_id:Number(classTeacherForm.teacher_id),class_id:Number(classTeacherForm.class_id)})})
      setClassTeacherForm({teacher_id:'',class_id:''});setClassTeacherAssignments(await api<any[]>('class-teacher-assignments',token));setMessage('Class-teacher responsibility assigned. This is separate from subject teaching assignments.')
    } catch(e) {setError(e instanceof Error?e.message:'Unable to assign class teacher.')}
    finally {setBusy(false)}
  }
  async function removeClassTeacher(id:number) {
    setBusy(true);setError('');setMessage('')
    try { await api('class-teacher-assignments/'+id,token,{method:'DELETE'});setClassTeacherAssignments(await api<any[]>('class-teacher-assignments',token));setMessage('Class-teacher responsibility removed.') }
    catch(e) {setError(e instanceof Error?e.message:'Unable to remove class teacher.')}
    finally {setBusy(false)}
  }
  async function assign(e:React.FormEvent) {
    e.preventDefault()
    if(!assignment.teacher_id||!assignment.class_id||!assignment.subject_id){setError('Select a teacher, class and one of their registered subjects before saving.');return}
    if(!availableAssignmentSubjects.some((subject:any)=>String(subject.id)===assignment.subject_id)){setError('The selected subject was not registered under this teacher. Update the teacher profile first.');return}
    setBusy(true);setError('');setMessage('')
    try {
      await api('teacher-assignments',token,{method:'POST',body:JSON.stringify({teacher_id:Number(assignment.teacher_id),class_id:Number(assignment.class_id),subject_id:Number(assignment.subject_id)})})
      setAssignment({teacher_id:'',class_id:'',subject_id:''});setMessage('Teacher class and subject assignment saved.')
    } catch(e) {setError(e instanceof Error?e.message:'Unable to assign teacher.')}
    finally {setBusy(false)}
  }
  const activeTeachers=users.filter(u=>u.role==='teacher'&&u.active)
  const selectedAssignmentTeacher=activeTeachers.find((u:any)=>String(u.id)===assignment.teacher_id)
  const selectedAssignmentStaff=staff.find((p:any)=>p.id===selectedAssignmentTeacher?.staff_id)
  const registeredTeacherSubjects=String(selectedAssignmentStaff?.subjects||'').split(',').map((name:string)=>name.trim()).filter(Boolean)
  const availableAssignmentSubjects=subjects.filter((subject:any)=>registeredTeacherSubjects.includes(subject.name))
  const editableUsers=users.filter(u=>u.role!=='admin'&&u.role!=='parent')
  const otherAccounts=users.filter(u=>u.role==='admin'||u.role==='parent')
  const staffLoginMatches=editableUsers.filter(u=>{
    const person=staff.find((p:any)=>p.id===u.staff_id)
    const haystack=[person?.first_name,person?.last_name,person?.staff_number,u.username,u.email,u.role_label,u.role].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(staffLoginSearch.trim().toLowerCase())
  })
  const otherLoginMatches=otherAccounts.filter(u=>[u.username,u.email,u.role_label,u.role].filter(Boolean).join(' ').toLowerCase().includes(otherLoginSearch.trim().toLowerCase()))
  const visibleStaffLogins=staffLoginMatches.slice(0,5)
  const visibleOtherLogins=otherLoginSearch.trim()?otherLoginMatches:otherLoginMatches.slice(0,8)
  const presetNames=Object.keys(catalog.presets||{})
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Staff accounts & access</h2><p>Staff login details are created automatically when you register a staff member in the Staff directory.</p></div><button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading||busy}>{loading?'Loading...':'Refresh'}</button></div>
    {error&&<div className="form-error" role="alert">{error}</div>}{message&&<div className="success-notice" role="status">{message}</div>}
    <div className="form-hint">Register employees from the Staff directory. This workspace manages access, assignments and existing accounts.</div>
    <div className="account-management-tabs" role="tablist" aria-label="User and permission settings">
      <button type="button" role="tab" aria-selected={accountTab==="access"} className={accountTab==="access"?"active":""} onClick={()=>setAccountTab("access")}>Access & roles</button>
      <button type="button" role="tab" aria-selected={accountTab==="assignments"} className={accountTab==="assignments"?"active":""} onClick={()=>setAccountTab("assignments")}>Teacher assignments</button>
      <button type="button" role="tab" aria-selected={accountTab==="staff"} className={accountTab==="staff"?"active":""} onClick={()=>setAccountTab("staff")}>Staff logins <span>{editableUsers.length}</span></button>
      <button type="button" role="tab" aria-selected={accountTab==="other"} className={accountTab==="other"?"active":""} onClick={()=>setAccountTab("other")}>Other accounts <span>{otherAccounts.length}</span></button>
    </div>
    {accountTab==='access'&&<div className="account-tab-panel">
    <h3>Manage a staff member's access</h3>
    {loading?<p className="form-hint">Loading staff accounts...</p>:!editableUsers.length?<p className="form-hint">No staff login accounts yet. Register a staff member first.</p>:<>
      <div className="student-form-grid">
        <label>Staff member *<select required value={selectedId} onChange={e=>{selectAccount(e.target.value);const account=users.find((u:any)=>String(u.id)===e.target.value);const person=staff.find((p:any)=>p.id===account?.staff_id);if(person){setRoleLabel(person.position||account.role_label||account.role);setRoleType(person.category==='Teaching'?'teacher':'staff')}}}><option value="">Choose staff account</option>{editableUsers.map(u=>{const person=staff.find((p:any)=>p.id===u.staff_id);return <option key={u.id} value={u.id}>{person?person.first_name+' '+person.last_name:u.username} — {u.username}</option>})}</select></label>
        <label>Access role *<select required value={presetNames.includes(roleLabel)?roleLabel:'Custom role'} onChange={e=>{if(e.target.value!=='Custom role')applyPreset(e.target.value)}}><option>Custom role</option>{presetNames.map((name:string)=><option key={name}>{name}</option>)}</select></label>
        <label>Job title / display role *<input required value={roleLabel} onChange={e=>setRoleLabel(e.target.value)} maxLength={80} placeholder="e.g. Bursar, Secretary, DOS"/></label>
        <label>Staff category *<select required value={roleType} onChange={e=>setRoleType(e.target.value as 'teacher'|'staff')}><option value="teacher">Teaching staff</option><option value="staff">Non-teaching staff</option></select></label>
      </div>
      {selectedId&&(()=>{const account=editableUsers.find((u:any)=>String(u.id)===selectedId);const person=staff.find((p:any)=>p.id===account?.staff_id);return <div className="selected-staff-summary"><strong>{person?[person.first_name,person.last_name].filter(Boolean).join(' '):account?.username}</strong><span>{person?.staff_number||'No staff number'} · {person?.category|| (roleType==='teacher'?'Teaching':'Non-teaching')} · {person?.department||'Department not set'}</span><small>Login: {account?.username} · Email: {account?.email||person?.email||'Not provided'} · Current role: {account?.role_label||account?.role}</small></div>})()}
      <details className="form-disclosure"><summary>Choose which areas this staff member can open</summary>
        <p className="form-hint">Choose the school areas this staff member is allowed to open. Selected areas appear in their menu.</p>
        <div className="permission-choice-grid">{(catalog.sections||[]).map((section:string)=><div key={section} className={permissions[section]?.includes('view')?'permission-choice-wrap active':'permission-choice-wrap'}><button type="button" className={permissions[section]?.includes('view')?'permission-choice active':'permission-choice'} aria-pressed={Boolean(permissions[section]?.includes('view'))} onClick={()=>toggleSection(section)}><span>{section}</span><small>{permissions[section]?.includes('view')?'Enabled · full access by default':'Not enabled'}</small></button>{permissions[section]?.includes('view')&&<div className="permission-action-filters" aria-label={section+' permitted actions'}>{permissionActions.map(action=><label key={action}><input type="checkbox" checked={(permissions[section]||[]).includes(action)} disabled={action==='view'} onChange={()=>togglePermissionAction(section,action)}/>{action}</label>)}</div>}</div>)}</div>
      </details>
      <div className="form-actions"><button type="button" className="primary-button" onClick={()=>void savePermissions()} disabled={busy||!selectedId}>{busy?'Saving...':'Save staff access'}</button></div>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={()=>void resetSelectedPassword()} disabled={busy||!selectedId}>{busy?'Working...':'Reset login passcode'}</button></div>
      {resetPasscode&&<div className="success-notice password-reset-result" role="status"><strong>Temporary passcode for {resetPasscode.username}</strong><code>{resetPasscode.password}</code><button type="button" className="secondary-button" onClick={()=>void navigator.clipboard.writeText('Username: '+resetPasscode.username+'\nTemporary passcode: '+resetPasscode.password)}>Copy login details</button><small>Shown once. Share it privately; the staff member must change it at their next sign-in.</small></div>}
    </>}
    </div>}
    {accountTab==='assignments'&&<div className="account-tab-panel">
    <h3>Assign classes and subjects to teachers</h3><p className="form-hint">A teacher can be assigned to multiple classes and multiple subjects, but each subject must first be selected in that teacher’s Staff registration profile.</p>
    <form className="student-form" onSubmit={assign}><div className="student-form-grid">
      <label>Teacher *<select required value={assignment.teacher_id} onChange={e=>setAssignment({...assignment,teacher_id:e.target.value,subject_id:''})}><option value="">Select teacher</option>{activeTeachers.map(u=>{const person=staff.find((p:any)=>p.id===u.staff_id);return <option key={u.id} value={u.id}>{person?person.first_name+' '+person.last_name:u.username}</option>})}</select></label>
      <label>Class *<select required value={assignment.class_id} onChange={e=>setAssignment({...assignment,class_id:e.target.value})}><option value="">Select class</option>{classes.map(item=><option key={item.id} value={item.id}>{item.name}{item.section?' — '+item.section:''}</option>)}</select></label>
      <label>Registered subject *<select required value={assignment.subject_id} onChange={e=>setAssignment({...assignment,subject_id:e.target.value})} disabled={!assignment.teacher_id||!availableAssignmentSubjects.length}><option value="">{!assignment.teacher_id?'Choose a teacher first':availableAssignmentSubjects.length?'Select one of this teacher’s subjects':'No subjects recorded for this teacher'}</option>{availableAssignmentSubjects.map((sub:any)=><option key={sub.id} value={sub.id}>{sub.name}</option>)}</select><small className="field-hint">Only subjects recorded in the selected teacher’s staff profile are listed.</small></label>
    </div><div className="form-actions"><button className="primary-button" disabled={busy||loading||!activeTeachers.length||!subjects.length||!classes.length}>{busy?'Saving...':'Save teacher assignment'}</button></div></form>
    <h3>Assign class teachers</h3>
    <p className="form-hint">This is a separate responsibility from teaching individual subjects. Each class has one assigned class teacher, who is authorised to manage that class's attendance register.</p>
    <form className="student-form" onSubmit={assignClassTeacher}><div className="student-form-grid">
      <label>Class teacher *<select required value={classTeacherForm.teacher_id} onChange={e=>setClassTeacherForm({...classTeacherForm,teacher_id:e.target.value})}><option value="">Select teacher</option>{activeTeachers.map(u=>{const person=staff.find((p:any)=>p.id===u.staff_id);return <option key={u.id} value={u.id}>{person?person.first_name+' '+person.last_name:u.username}</option>})}</select></label>
      <label>Responsible class *<select required value={classTeacherForm.class_id} onChange={e=>setClassTeacherForm({...classTeacherForm,class_id:e.target.value})}><option value="">Select class</option>{classes.map(item=><option key={item.id} value={item.id}>{item.name}{item.section?' — '+item.section:''}</option>)}</select></label>
    </div><div className="form-actions"><button className="primary-button" disabled={busy||loading||!activeTeachers.length||!classes.length}>{busy?'Saving...':'Assign class teacher'}</button></div></form>
    <div className="table-wrap"><table><thead><tr><th>Class</th><th>Assigned class teacher</th><th>Action</th></tr></thead><tbody>{classTeacherAssignments.map(row=><tr key={row.id}><td>{row.class_name}{row.section?' — '+row.section:''}</td><td>{staff.find((p:any)=>users.find(u=>u.id===row.teacher_id)?.staff_id===p.id)?.first_name || row.teacher_name} {staff.find((p:any)=>users.find(u=>u.id===row.teacher_id)?.staff_id===p.id)?.last_name || ''}</td><td><button type="button" className="secondary-button" disabled={busy} onClick={()=>void removeClassTeacher(row.id)}>Remove</button></td></tr>)}{!classTeacherAssignments.length&&<tr><td colSpan={3}>No class teachers assigned yet.</td></tr>}</tbody></table></div>
    </div>}
    {accountTab==='staff'&&<div className="account-tab-panel">
    <h3>School staff login accounts</h3>
    <p className="form-hint">Staff accounts are separate from administrator and parent accounts. The first 5 matching accounts are shown; search to find any other account.</p>
    <div className="table-tools student-tools"><div className="search-box"><Search size={17}/><input aria-label="Search staff login accounts" placeholder="Search staff name, staff number or username..." value={staffLoginSearch} onChange={e=>setStaffLoginSearch(e.target.value)}/></div><span className="count-pill">Showing {visibleStaffLogins.length} of {staffLoginMatches.length} matching staff accounts</span></div>
    <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Username</th><th>Job role</th><th>Areas available</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {visibleStaffLogins.map(u=>{const person=staff.find((p:any)=>p.id===u.staff_id);return <tr key={u.id}><td>{person?person.first_name+' '+person.last_name:'Unlinked staff login'}</td><td>{u.username}</td><td>{u.role_label||u.role}</td><td>{Object.keys(u.permissions||{}).length||'Limited'}</td><td>{u.active?'Active':'Disabled'}</td><td><button type="button" className="secondary-button" disabled={busy} onClick={()=>{setSelectedId(String(u.id));setResetPasscode(null);setRoleLabel(u.role_label||u.role);setRoleType(u.role==='teacher'?'teacher':'staff');setPermissions(u.permissions||{});void resetAccountPassword(String(u.id),u.username)}}>Reset password</button></td></tr>})}
      {!staffLoginMatches.length&&<tr><td colSpan={6}>No staff login accounts match this search.</td></tr>}
    </tbody></table></div>
    {resetPasscode&&<div className="success-notice password-reset-result" role="status"><strong>Temporary password for {resetPasscode.username}</strong><code>{resetPasscode.password}</code><button type="button" className="secondary-button" onClick={()=>void navigator.clipboard.writeText('Username: '+resetPasscode.username+'\\nTemporary password: '+resetPasscode.password)}>Copy login details</button><small>Shown once. Share it privately. The staff member must change it at their next sign-in.</small></div>}
    </div>}
    {accountTab==='other'&&<div className="account-tab-panel">
    <h3>Other system accounts</h3>
    <p className="form-hint">Administrator and parent accounts are kept separate from staff logins.</p>
    <div className="table-tools student-tools"><div className="search-box"><Search size={17}/><input aria-label="Search administrator and parent accounts" placeholder="Search administrator or parent accounts..." value={otherLoginSearch} onChange={e=>setOtherLoginSearch(e.target.value)}/></div><span className="count-pill">{otherLoginMatches.length} accounts</span></div>
    <div className="table-wrap"><table><thead><tr><th>Account type</th><th>Username</th><th>Email</th><th>Status</th></tr></thead><tbody>
      {visibleOtherLogins.map(u=><tr key={u.id}><td>{u.role==='admin'?'Administrator':'Parent'}</td><td>{u.username}</td><td>{u.email||'—'}</td><td>{u.active?'Active':'Disabled'}</td></tr>)}
      {!otherLoginMatches.length&&<tr><td colSpan={4}>No administrator or parent accounts match this search.</td></tr>}
    </tbody></table></div>
    </div>}
  </section>
}
function BackupSettings({token}:{token:string}) {
  const [file,setFile]=useState<File|null>(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function createBackup(){
    setBusy(true);setError('');setMessage('')
    try {
      const response=await fetchSchoolBridge(`${API_BASE_URL}/api/backups/create`,{method:'POST',headers:{Authorization:'Bearer '+token}})
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||'Backup failed')}
      const blob=await response.blob()
      const url=URL.createObjectURL(blob)
      const link=document.createElement('a');link.href=url;link.download='schoolbridge-backup-'+new Date().toISOString().slice(0,10)+'.sqlite3'
      document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)
      setMessage('Database backup created and downloaded. Keep a copy somewhere safe.')
    } catch(e){setError(e instanceof Error?e.message:'Unable to create backup.')}
    finally{setBusy(false)}
  }
  async function restoreBackup(){
    if(!file)return
    if(!window.confirm('Restore this backup? Current school data will be replaced. A safety copy of the current database will be kept.'))return
    setBusy(true);setError('');setMessage('')
    try {
      const body=new FormData();body.append('file',file)
      const response=await fetchSchoolBridge(`${API_BASE_URL}/api/backups/restore`,{method:'POST',headers:{Authorization:'Bearer '+token},body})
      const data=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(data.detail||'Restore failed')
      setMessage(data.message||'Restore staged. Restart the backend to complete it.')
      setFile(null)
    } catch(e){setError(e instanceof Error?e.message:'Unable to restore backup.')}
    finally{setBusy(false)}
  }
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Backups and restore</h2><p>Download a copy of the local school database or restore from a previous SchoolBridge backup.</p></div></div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {message&&<div className="success-notice" role="status">{message}</div>}
    <div className="backup-action"><h3>Create a backup</h3><p>Includes student, staff, academic, fee, payment and settings records.</p><button className="primary-button" type="button" disabled={busy} onClick={()=>void createBackup()}>{busy?'Working...':'Create and download backup'}</button></div>
    <div className="backup-action"><h3>Restore a backup</h3><p>Only restore a valid SchoolBridge SQLite backup. The current database is copied to a safety file before restoration.</p><label>Select backup file<input type="file" accept=".sqlite,.sqlite3,.db" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/></label>{file&&<p className="form-hint">Selected: {file.name}</p>}<div className="form-actions"><button className="secondary-button" type="button" disabled={!file||busy} onClick={()=>void restoreBackup()}>{busy?'Restoring...':'Restore selected backup'}</button></div></div>
    <p className="form-hint">For PostgreSQL multi-computer installations, use the database administrator's backup procedure. File-based backup and restore here applies to the local SQLite installation.</p>
  </section>
}

function AuditLogSettings({token}:{token:string}) {
  const [items,setItems]=useState<any[]>([])
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  async function load(){
    setLoading(true);setError('')
    try {const result=await api<{items:any[]}>('audit-logs?page=1&page_size=100',token);setItems(result.items)}
    catch(e){setError(e instanceof Error?e.message:'Unable to load audit records.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[token])
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Audit log</h2><p>Recent administrator actions, financial entries and profile changes. Financial records are retained rather than silently deleted.</p></div><button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading}>{loading?'Loading...':'Refresh audit log'}</button></div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {loading?<p className="form-hint">Loading audit records...</p>:<div className="table-wrap"><table><thead><tr><th>Date and time</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>
      {items.map(item=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.actor_username}</td><td>{item.action}</td><td>{item.entity_type} #{item.entity_id}</td><td>{item.details||'—'}</td></tr>)}
      {!items.length&&<tr><td colSpan={5}>No audit events have been recorded yet.</td></tr>}
    </tbody></table></div>}
  </section>
}

const PRIMARY_SUBJECT_CATALOGUE = [
  { group: 'Languages', names: ['English', 'Luganda', 'Kiswahili', 'Runyankole-Rukiga', 'Lusoga', 'Ateso', 'Luo'] },
  { group: 'Mathematics', names: ['Mathematics'] },
  { group: 'Integrated learning', names: ['Literacy', 'Reading', 'Writing', 'Social Studies', 'Religious Education', 'Christian Religious Education', 'Islamic Religious Education'] },
  { group: 'Science and environment', names: ['Primary Science', 'Agriculture', 'Environmental Studies', 'Health Education'] },
  { group: 'Creative and practical', names: ['Physical Education', 'Creative Arts', 'Music', 'Art and Craft', 'ICT'] },
]

const SECONDARY_SUBJECT_CATALOGUE = [
  { group: 'Languages', names: ['English Language', 'Literature in English', 'Kiswahili', 'French', 'German', 'Arabic', 'Chinese', 'Luganda', 'Runyankole-Rukiga', 'Lusoga', 'Ateso', 'Luo'] },
  { group: 'Sciences', names: ['Biology', 'Chemistry', 'Physics', 'Agriculture', 'General Science', 'Computer Studies'] },
  { group: 'Mathematics', names: ['Mathematics', 'Additional Mathematics', 'Subsidiary Mathematics'] },
  { group: 'Humanities', names: ['History', 'Geography', 'Religious Education', 'Christian Religious Education', 'Islamic Religious Education', 'Political Education', 'Divinity'] },
  { group: 'Business and technical', names: ['Commerce', 'Entrepreneurship Education', 'Economics', 'Accounting', 'Business Studies', 'Food and Nutrition', 'Home Economics', 'Art and Design', 'Fine Art', 'Music', 'Physical Education', 'Agriculture and Nutrition', 'Technical Drawing', 'Woodwork', 'Metalwork', 'ICT'] },
]

function SubjectSettings({token,schoolType}:{token:string;schoolType:'Primary'|'Secondary'|'Combined'}) {
  const [curriculumType,setCurriculumType]=useState<'Primary'|'Secondary'>(schoolType==='Secondary'?'Secondary':'Primary')
  const effectiveSchoolType=schoolType==='Combined'?curriculumType:schoolType
  const catalogue = effectiveSchoolType === 'Primary' ? PRIMARY_SUBJECT_CATALOGUE : SECONDARY_SUBJECT_CATALOGUE
  const [subjects,setSubjects]=useState<any[]>([])
  const [selected,setSelected]=useState<string[]>([])
  const [customName,setCustomName]=useState('')
  const [search,setSearch]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)

  async function load() {
    setLoading(true);setError('')
    try { setSubjects(await api<any[]>('subjects',token)) }
    catch(e) { setError(e instanceof Error?e.message:'Unable to load subjects.') }
    finally { setLoading(false) }
  }
  useEffect(()=>{void load()},[token,schoolType])

  const currentCurriculumSubjects=subjects.filter(subject=>subject.school_type===effectiveSchoolType)
  const existingNames=new Set(currentCurriculumSubjects.map(subject=>String(subject.name).trim().toLocaleLowerCase()))
  const available=(name:string)=>!existingNames.has(name.trim().toLocaleLowerCase())
  const visibleGroups=catalogue.map(group=>({
    ...group,
    names:group.names.filter(name=>available(name)&&name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  })).filter(group=>group.names.length)

  function toggleSubject(name:string) {
    setSelected(current=>current.includes(name)?current.filter(item=>item!==name):[...current,name])
    setError('');setMessage('')
  }

  async function addSelected(e:React.FormEvent) {
    e.preventDefault()
    const custom=customName.trim()
    const names=[...selected,...(custom?[custom]:[])]
    const unique=[...new Map(names.map(name=>[name.toLocaleLowerCase(),name])).values()]
    if(!unique.length){setError('Choose at least one subject from the list or enter a custom subject.');return}
    const alreadyExists=unique.filter(name=>existingNames.has(name.toLocaleLowerCase()))
    const toCreate=unique.filter(name=>!existingNames.has(name.toLocaleLowerCase()))
    if(!toCreate.length){setError('All selected subjects already exist. Choose other subjects.');return}
    setBusy(true);setError('');setMessage('')
    const added:string[]=[]
    const skipped=[...alreadyExists]
    const failed:string[]=[]
    try {
      for(const subjectName of toCreate) {
        try {
          await api('subjects',token,{method:'POST',body:JSON.stringify({name:subjectName,code:null,school_type:effectiveSchoolType})})
          added.push(subjectName)
        } catch(err) {
          const reason=err instanceof Error?err.message:'Unable to add subject.'
          if(reason.includes('HTTP 409')) skipped.push(subjectName)
          else failed.push(subjectName+' ('+reason+')')
        }
      }
      await load()
      setSelected(current=>current.filter(name=>!added.includes(name)))
      if(added.length) setCustomName('')
      setMessage(added.length+' subject'+(added.length===1?'':'s')+' added. '+(skipped.length?skipped.length+' already existed. ':'')+(failed.length?failed.length+' could not be added.':''))
      if(failed.length) setError('Could not add: '+failed.join('; '))
    } catch(err) {
      setError(err instanceof Error?err.message:'Unable to refresh the subject list.')
    } finally {setBusy(false)}
  }

  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>{schoolType==='Combined'?'Combined school subjects':effectiveSchoolType+' school subjects'}</h2><p>{schoolType==='Combined'?'Manage Primary and Secondary subjects separately for the two parts of your school.':'Only the '+effectiveSchoolType.toLowerCase()+' curriculum is shown here.'}</p></div><button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading||busy}>{loading?'Loading...':'Refresh subjects'}</button></div>
    {schoolType==='Combined'&&<div className="settings-section-tabs" role="tablist" aria-label="School curriculum"><button type="button" role="tab" aria-selected={curriculumType==='Primary'} className={curriculumType==='Primary'?'active':''} onClick={()=>{setCurriculumType('Primary');setSelected([]);setCustomName('');setSearch('')}}>Primary curriculum</button><button type="button" role="tab" aria-selected={curriculumType==='Secondary'} className={curriculumType==='Secondary'?'active':''} onClick={()=>{setCurriculumType('Secondary');setSelected([]);setCustomName('');setSearch('')}}>Secondary curriculum</button></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {message&&<div className="success-notice" role="status">{message}</div>}
    <details className="form-disclosure" open><summary>Add school subjects</summary>
      <form className="student-form" onSubmit={addSelected}>
        <label>Find a subject<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search the subject list"/></label>
        <p className="form-hint">Tap each subject you want to add. Selected subjects are highlighted; subjects already registered in this curriculum are hidden.</p>
        {loading?<p className="form-hint">Loading available subjects...</p>:<div className="subject-catalogue">
          {visibleGroups.map(group=><fieldset className="subject-catalogue-group" key={group.group}>
            <legend>{group.group}</legend>
            <div className="subject-catalogue-options">
              {group.names.map(name=><button type="button" className={selected.includes(name)?"subject-choice-button active":"subject-choice-button"} key={name} aria-pressed={selected.includes(name)} onClick={()=>toggleSubject(name)}>{name}</button>)}
            </div>
          </fieldset>)}
          {!visibleGroups.length&&<p className="form-hint">No more matching subjects in the catalogue.</p>}
        </div>}
        <label>Other subject not listed<input maxLength={100} value={customName} onChange={e=>setCustomName(e.target.value)} placeholder="Enter another subject name"/></label>
        <div className="subject-selection-review"><strong>Selected for addition ({selected.length+(customName.trim()?1:0)})</strong>
          {selected.length||customName.trim()?<div className="subject-selection-tags">{selected.map(name=><span key={name}>{name}</span>)}{customName.trim()&&<span>{customName.trim()} (custom)</span>}</div>:<p className="form-hint">Your selected subjects will appear here before confirmation.</p>}
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy||loading||(!selected.length&&!customName.trim())}>{busy?'Adding subjects...':'Confirm and add selected subjects'}</button></div>
      </form>
    </details>
    <div className="panel-heading"><div><h3>Registered subjects</h3><p>{currentCurriculumSubjects.length} {effectiveSchoolType.toLowerCase()} subject{currentCurriculumSubjects.length===1?'':'s'} currently available</p></div></div>
    {loading?<p className="form-hint">Loading subjects...</p>:<div className="table-wrap"><table><thead><tr>{schoolType==='Combined'&&<th>Curriculum</th>}<th>Subject</th><th>Code</th></tr></thead><tbody>
      {currentCurriculumSubjects.map(subject=><tr key={subject.id}>{schoolType==='Combined'&&<td>{subject.school_type}</td>}<td>{subject.name}</td><td>{subject.code||'—'}</td></tr>)}
      {!currentCurriculumSubjects.length&&<tr><td colSpan={schoolType==='Combined'?3:2}>No subjects have been added to this curriculum yet.</td></tr>}
    </tbody></table></div>}
  </section>
}

type PrefectRow = {
  id: number; student_id: number; student_name: string; admission_number: string;
  class_name: string; stream?: string | null; position: string; start_date: string;
  end_date?: string | null; active: boolean;
}
type DutyRow = {
  id: number; staff_id: number; teacher_name: string; staff_number: string;
  duty_date: string; notes?: string | null;
}
type LeadershipStudent = { id: number; first_name: string; last_name: string; admission_number: string; class_id?: number | null }
type LeadershipStaff = { id: number; first_name: string; last_name: string; staff_number: string; category: string; status: string }

function LeadershipDuty({token}:{token:string}) {
  const [prefects,setPrefects]=useState<PrefectRow[]>([])
  const [duties,setDuties]=useState<DutyRow[]>([])
  const [students,setStudents]=useState<LeadershipStudent[]>([])
  const [staff,setStaff]=useState<LeadershipStaff[]>([])
  const [studentSearch,setStudentSearch]=useState('')
  const [studentId,setStudentId]=useState('')
  const [position,setPosition]=useState('Head Prefect')
  const [prefectStart,setPrefectStart]=useState(new Date().toISOString().slice(0,10))
  const [prefectEnd,setPrefectEnd]=useState('')
  const [staffId,setStaffId]=useState('')
  const [dutyDate,setDutyDate]=useState(new Date().toISOString().slice(0,10))
  const [dutyNotes,setDutyNotes]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)

  async function loadAll() {
    setLoading(true)
    try {
    const [p,d,s,t]=await Promise.all([
      api<PrefectRow[]>('leadership/prefects?active_only=false',token),
      api<DutyRow[]>('leadership/teacher-duties',token),
      api<{items:LeadershipStudent[]}>('students/search?page=1&page_size=5&search='+encodeURIComponent(studentSearch),token),
      api<{items:LeadershipStaff[]}>('staff?page=1&page_size=100&category=Teaching',token),
    ])
    setPrefects(p);setDuties(d);setStudents(s.items);setStaff(t.items.filter(x=>x.status==='active'))
    } finally { setLoading(false) }
  }
  useEffect(()=>{void loadAll().catch(e=>setError(e instanceof Error?e.message:'Unable to load leadership records.'))},[token,studentSearch])

  async function appoint(e:React.FormEvent) {
    e.preventDefault();setBusy(true);setError('');setMessage('')
    try {
      await api('leadership/prefects',token,{method:'POST',body:JSON.stringify({
        student_id:Number(studentId),position,start_date:prefectStart,end_date:prefectEnd||null
      })})
      setMessage('Student prefect appointed successfully.');setStudentId('');setPrefectEnd('');await loadAll()
    } catch(e) {setError(e instanceof Error?e.message:'Unable to appoint prefect.')}
    finally {setBusy(false)}
  }
  async function assignDuty(e:React.FormEvent) {
    e.preventDefault();setBusy(true);setError('');setMessage('')
    try {
      await api('leadership/teacher-duties',token,{method:'POST',body:JSON.stringify({
        staff_id:Number(staffId),duty_date:dutyDate,notes:dutyNotes||null
      })})
      setMessage('Teacher duty assigned successfully.');setDutyNotes('');await loadAll()
    } catch(e) {setError(e instanceof Error?e.message:'Unable to assign teacher duty.')}
    finally {setBusy(false)}
  }
  async function endAppointment(id:number) {
    if(!window.confirm('End this prefect appointment?'))return
    setBusy(true);setError('');setMessage('')
    try {await api('leadership/prefects/'+id+'/end',token,{method:'PATCH'});setMessage('Prefect appointment ended.');await loadAll()}
    catch(e){setError(e instanceof Error?e.message:'Unable to update prefect appointment.')}
    finally {setBusy(false)}
  }
  async function removeDuty(id:number) {
    if(!window.confirm('Remove this duty assignment?'))return
    setBusy(true);setError('');setMessage('')
    try {await api('leadership/teacher-duties/'+id,token,{method:'DELETE'});setMessage('Duty assignment removed.');await loadAll()}
    catch(e){setError(e instanceof Error?e.message:'Unable to remove duty assignment.')}
    finally {setBusy(false)}
  }
  const activePrefects=prefects.filter(x=>x.active)
  const today=new Date().toISOString().slice(0,10)
  const currentDuty=duties.find(x=>x.duty_date===today)
  return <div className="leadership-workspace">
    <section className="leadership-summary">
      <div className="leadership-summary-card"><span>Active prefects</span><strong>{activePrefects.length}</strong><small>Current student leadership team</small></div>
      <div className="leadership-summary-card"><span>Duty today</span><strong>{currentDuty?.teacher_name||'Not assigned'}</strong><small>{today}</small></div>
      <div className="leadership-summary-card"><span>Duty records</span><strong>{duties.length}</strong><small>Recent scheduled assignments</small></div>
    </section>
    {message&&<div className="success-notice" role="status">{message}</div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    <section className="panel">
      <div className="panel-heading"><div><h2>Prefectorial body</h2><p>Appoint student leaders and keep track of their service terms.</p></div><button type="button" className="secondary-button" onClick={()=>void loadAll().catch(e=>setError(e instanceof Error?e.message:'Unable to refresh leadership records.'))} disabled={loading||busy}>{loading?'Loading...':'Refresh records'}</button></div>
      <details className="form-disclosure"><summary>Appoint a student prefect</summary><form className="student-form" onSubmit={appoint}>
        <div className="student-form-grid">
          <label>Find student<input value={studentSearch} onChange={e=>setStudentSearch(e.target.value)} placeholder="Search name or admission number"/></label>
          <label>Student<select value={studentId} onChange={e=>setStudentId(e.target.value)} required><option value="">Choose student</option>{students.map(s=><option key={s.id} value={s.id}>{s.first_name} {s.last_name} · {s.admission_number}</option>)}</select></label>
          <label>Prefect position<select value={position} onChange={e=>setPosition(e.target.value)}>{['Head Prefect','Deputy Head Prefect','Head Girl','Head Boy','Games Prefect','Dining Prefect','Health Prefect','Timekeeper','Class Prefect','Library Prefect','Sanitation Prefect','Other'].map(x=><option key={x}>{x}</option>)}</select></label>
          <label>Start date<input type="date" value={prefectStart} onChange={e=>setPrefectStart(e.target.value)} required/></label>
          <label>End date (optional)<input type="date" value={prefectEnd} min={prefectStart} onChange={e=>setPrefectEnd(e.target.value)}/></label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy||!studentId}>{busy?'Saving...':'Appoint prefect'}</button></div>
      </form></details>
      {loading?<p className="form-hint">Loading leadership records...</p>:<div className="table-wrap"><table><thead><tr><th>Position</th><th>Student</th><th>Admission no.</th><th>Class</th><th>Term</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {prefects.map(p=><tr key={p.id}><td>{p.position}</td><td>{p.student_name}</td><td>{p.admission_number}</td><td>{p.class_name}{p.stream?' · '+p.stream:''}</td><td>{p.start_date}{p.end_date?' – '+p.end_date:''}</td><td>{p.active?'Active':'Ended'}</td><td>{p.active&&<button className="secondary-button" type="button" disabled={busy} onClick={()=>void endAppointment(p.id)}>End term</button>}</td></tr>)}
        {!prefects.length&&<tr><td colSpan={7}>No prefect appointments recorded yet.</td></tr>}
      </tbody></table></div>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Teachers on duty</h2><p>Schedule active teaching staff and maintain a duty roster.</p></div></div>
      <details className="form-disclosure"><summary>Assign a teacher on duty</summary><form className="student-form" onSubmit={assignDuty}>
        <div className="student-form-grid">
          <label>Teacher<select value={staffId} onChange={e=>setStaffId(e.target.value)} required><option value="">Choose teacher</option>{staff.map(s=><option key={s.id} value={s.id}>{s.first_name} {s.last_name} · {s.staff_number}</option>)}</select></label>
          <label>Duty date<input type="date" value={dutyDate} onChange={e=>setDutyDate(e.target.value)} required/></label>
          <label>Notes / duty area<input value={dutyNotes} onChange={e=>setDutyNotes(e.target.value)} placeholder="e.g. Main gate and morning assembly"/></label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy||!staffId||staff.length===0}>{busy?'Saving...':'Assign teacher on duty'}</button></div>
        {staff.length===0&&<p className="form-hint">Add active teaching staff in the Staff section before assigning duty.</p>}
      </form></details>
      {loading?<p className="form-hint">Loading duty records...</p>:<div className="table-wrap"><table><thead><tr><th>Duty date</th><th>Teacher</th><th>Staff no.</th><th>Notes / duty area</th><th>Action</th></tr></thead><tbody>
        {duties.map(d=><tr key={d.id}><td>{d.duty_date}</td><td>{d.teacher_name}</td><td>{d.staff_number}</td><td>{d.notes||'—'}</td><td><button className="secondary-button" type="button" disabled={busy} onClick={()=>void removeDuty(d.id)}>Remove</button></td></tr>)}
        {!duties.length&&<tr><td colSpan={5}>No teacher duty assignments recorded yet.</td></tr>}
      </tbody></table></div>}
    </section>
  </div>
}
