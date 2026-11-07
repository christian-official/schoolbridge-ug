import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  FileText, Settings, LogOut,
  Search, Plus, Menu, X, ArrowUpRight, UserPlus,
  CalendarDays, TrendingUp, ShieldCheck, LoaderCircle, RefreshCw,
} from 'lucide-react'
import StaffFinance from './StaffFinance'
import './App.css'

type User = {
  id: number
  username: string
  email: string
  role: string
  active: boolean
}

type StudentPage = { items: RecordItem[]; total: number; page: number; pages: number }

type DashboardSummary = {
  active_students: number
  new_admissions_this_year: number
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
}

const menu = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Students', icon: GraduationCap },
  { label: 'Staff', icon: Users },
  { label: 'Fees & Finance', icon: FileText },
  { label: 'Examinations', icon: FileText },
  { label: 'Leadership & Duty', icon: ShieldCheck },
]
const teacherMenu = [
  { label: 'My Classes', icon: BookOpen },
  { label: 'Attendance', icon: CalendarDays },
]

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
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

function App() {
  const [token, setToken] = useState(sessionStorage.getItem('sb_token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState('Overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [settingsSection, setSettingsSection] = useState('home')
  const [students, setStudents] = useState<RecordItem[]>([])
  const [studentTotal, setStudentTotal] = useState(0)
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({ active_students: 0, new_admissions_this_year: 0, active_staff: 0, total_classes: 0, academic_year: new Date().getFullYear() })
  const [studentPage, setStudentPage] = useState(1)
  const [studentClassFilter, setStudentClassFilter] = useState('')
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
    first_name: '', middle_name: '', last_name: '', full_name: '', a_level_stream: '', gender: '', date_of_birth: '', class_id: '',
    religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', previous_school: '',
    admission_date: new Date().toISOString().slice(0, 10), fee_amount: '', academic_level: '', combination: '', optional_subjects: '', subsidiary_subjects: '',
  })
  const [mobileMenu, setMobileMenu] = useState(false)
  const [admissionSettings, setAdmissionSettings] = useState<AdmissionSettings>({
    admission_prefix: 'SB', include_year: true, admission_separator: '-',
    admission_padding: 4, next_admission_number: 1,
  })
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  const [schoolConfig, setSchoolConfig] = useState<any>({ school_type: 'Primary', a_level_combinations: '', o_level_optional_subjects: '', a_level_subsidiary_subjects: '' })

  useEffect(()=>{if(token)api<any>('settings/school-profile',token).then(setSchoolConfig).catch(()=>{})},[token,active])

  async function loadSchoolData(authToken: string) {
    setDataError('')
    try {
      const [studentData, classData, admissionData, summaryData] = await Promise.all([
        api<StudentPage>('students/search?page=1&page_size=25', authToken),
        api<RecordItem[]>('classes', authToken),
        api<AdmissionSettings>('settings/admission-number', authToken),
        api<DashboardSummary>('dashboard/summary', authToken),
      ])
      setStudents(studentData.items)
      setStudentTotal(studentData.total)
      setStudentPage(1)
      setClasses(classData)
      setAdmissionSettings(admissionData)
      setDashboardSummary(summaryData)
    } catch {
      setDataError('Some school records could not be loaded. Check your connection and permissions.')
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
    setSavingStudent(true)
    setStudentError('')
    setStudentSuccess('')
    try {
      const createdStudent = await api<RecordItem>('students', token, {
        method: 'POST',
        body: JSON.stringify({
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
          previous_school: studentForm.previous_school.trim() || null,
          admission_date: studentForm.admission_date || null,
          gender: studentForm.gender || null,
          date_of_birth: studentForm.date_of_birth || null,
          class_id: Number(studentForm.class_id),
          fee_amount: studentForm.fee_amount === '' ? null : Number(studentForm.fee_amount),
          academic_level: schoolConfig.school_type==='Secondary' ? selectedAcademicLevel || null : null,
          combination: selectedAcademicLevel==='A-Level' && studentForm.a_level_stream && studentForm.combination ? `${studentForm.a_level_stream} — ${studentForm.combination}` : null,
          optional_subjects: selectedAcademicLevel==='O-Level' ? studentForm.optional_subjects || null : null,
          subsidiary_subjects: selectedAcademicLevel==='A-Level' ? studentForm.subsidiary_subjects || null : null,
        }),
      })
      setStudentForm({ first_name: '', middle_name: '', last_name: '', full_name: '', a_level_stream: '', gender: '', date_of_birth: '', class_id: '', religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', previous_school: '', admission_date: new Date().toISOString().slice(0, 10), fee_amount: '', academic_level: '', combination: '', optional_subjects: '', subsidiary_subjects: '' })
      setShowStudentForm(false)
      setStudentSuccess(`Student registered successfully. Admission number: ${createdStudent.admission_number}`)
      await loadSchoolData(token)
    } catch (error) {
      setStudentError(error instanceof Error ? error.message : 'Unable to register student.')
    } finally {
      setSavingStudent(false)
    }
  }


  async function saveAdmissionSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingSettings(true)
    setSettingsError('')
    setSettingsSuccess('')
    try {
      const saved = await api<AdmissionSettings & { message: string }>('settings/admission-number', token, {
        method: 'PUT',
        body: JSON.stringify(admissionSettings),
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
    try { const result=await api<any>('students/'+id+'/profile',token); setStudentProfile(result); setProfileMessage('') }
    catch(error) { setDataError(error instanceof Error?error.message:'Unable to open student profile.') }
  }

  async function dismissStudent(id:number) {
    if (!window.confirm('Dismiss this student? Their academic and financial history will be retained.')) return
    try {
      await api('students/' + id + '/status?status=dismissed', token, { method: 'PATCH' })
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
        guardian_phone:student.guardian_phone||null,previous_school:student.previous_school||null,
        admission_date:student.admission_date||null,class_id:student.class_id,status:student.status
      })})
      setStudentProfile({...studentProfile,student:updated.student})
      setProfileMessage('Student profile saved. Existing fee and academic records were retained.')
      await loadStudentPage(studentPage,search)
    } catch(error) {setProfileMessage(error instanceof Error?error.message:'Unable to save student profile.')}
    finally {setProfileSaving(false)}
  }

  async function loadStudentPage(page = 1, query = search) {
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '25', search: query })
      if (studentClassFilter) params.set('class_id', studentClassFilter)
      const result = await api<StudentPage>('students/search?' + params.toString(), token)
      setStudents(result.items); setStudentTotal(result.total); setStudentPage(result.page)
    } catch (error) { setDataError(error instanceof Error ? error.message : 'Unable to load student records.') }
  }

  useEffect(() => { if (token && active === 'Students') void loadStudentPage(1, search) }, [search, studentClassFilter, active, token])

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
      else await loadSchoolData(authToken)
    } catch (error) {
      sessionStorage.removeItem('sb_token')
      setToken('')
      setUser(null)
      setLoginError(error instanceof Error ? `Sign-in succeeded, but account verification failed: ${error.message}` : 'Sign-in succeeded, but account verification failed.')
    }
  }

  useEffect(() => {
    if (token) void loadUser(token)
  }, [token])

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setLoginError('')
    try {
      const body = new URLSearchParams()
      body.set('username', username)
      body.set('password', password)
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Login failed')
      sessionStorage.setItem('sb_token', result.access_token)
      setToken(result.access_token)
      setPassword('')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    sessionStorage.removeItem('sb_token')
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

  if (!token || !user) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="brand-mark"><GraduationCap size={30} /></div>
          <div className="brand-name">School<span>Bridge</span></div>
          <p className="login-subtitle">Your school's operations, connected.</p>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your school workspace.</p>
          <form onSubmit={login}>
            <label htmlFor="username">Username</label>
            <input id="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your username" required />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required />
            {loginError && <p className="error">{loginError}</p>}
            <button className="primary-button login-button" disabled={loading}>
              {loading ? <><LoaderCircle className="spin" size={18} /> Signing in...</> : 'Sign in'}
            </button>
          </form>
          <p className="login-foot"><ShieldCheck size={15} /> Secure school access</p>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell" onSubmitCapture={validateRequiredFields}>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><GraduationCap size={25} /></div>
          <div className="brand-name">School<span>Bridge</span></div>
          <button className="mobile-close" onClick={() => setMobileMenu(false)}><X /></button>
        </div>
        <div className="school-label">SCHOOL MANAGEMENT</div>
        <nav>
          {(user.role === 'teacher' ? teacherMenu : menu).map(item => {
            const Icon = item.icon
            return (
              <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} onClick={() => { setActive(item.label); setMobileMenu(false) }}>
                <Icon size={19} /> <span>{item.label}</span>
                {active === item.label && <span className="active-dot" />}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-bottom">
          {user.role === 'admin' && <button className="nav-item" onClick={() => setActive('Settings')}><Settings size={19} /> Settings</button>}
          <div className="profile-card">
            <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
            <div className="profile-info"><strong>{user.username}</strong><small>{user.role}</small></div>
            <button className="logout-button" title="Sign out" onClick={logout}><LogOut size={18} /></button>
          </div>
        </div>
      </aside>

      {mobileMenu && <button className="mobile-overlay" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)}><Menu /></button>
          <div className="breadcrumb">School workspace <span>/</span> <strong>{active}</strong></div>
          <div className="top-actions">
            <button className="secondary-button refresh-button" type="button" onClick={() => void refreshWorkspace()} disabled={isRefreshing} aria-live="polite">
              {isRefreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <span className="online-status"><i /> System online</span>
            <div className="top-avatar">{user.username.slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        <div className="content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">SCHOOL MANAGEMENT SYSTEM</p>
              <h1>{active === 'Overview' ? 'Dashboard overview' : active}</h1>
              <p className="muted">Welcome back, {user.username}. Here's your school at a glance.</p>
            </div>
            <div className="date-chip"><CalendarDays size={17} /> {new Date().toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          </div>

          {dataError && <div className="notice">{dataError} <button onClick={() => void loadSchoolData(token)}>Retry</button></div>}

          {(active === 'My Classes' || active === 'Attendance') && user.role === 'teacher' && <TeacherWorkspace token={token} active={active} />}

          {active === 'Overview' && (
            <>
              <section className="stats-grid">
                <StatCard title="Total students" value={studentTotal} icon={<GraduationCap />} note="All registered students" />
                <StatCard title="New admissions" value={dashboardSummary.new_admissions_this_year} icon={<UserPlus />} note={`Admitted in ${dashboardSummary.academic_year}`} />
                <StatCard title="Active staff" value={dashboardSummary.active_staff} icon={<Users />} note="Teaching and non-teaching" />
                <StatCard title="Total classes" value={dashboardSummary.total_classes} icon={<BookOpen />} note="Classes and streams" />
              </section>
              <section className="dashboard-grid">
                <div className="panel recent-panel">
                  <div className="panel-heading"><div><h2>School setup & administration</h2><p>Important settings to keep your school workspace organised</p></div></div>
                  <button className="quick-action" onClick={() => { setActive('Settings'); setSettingsSection('academic') }}><span className="quick-icon blue"><CalendarDays /></span><span><strong>Academic year & terms</strong><small>Set the current school year and active term</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => { setActive('Settings'); setSettingsSection('school') }}><span className="quick-icon purple"><GraduationCap /></span><span><strong>School profile</strong><small>Maintain school name and contact details</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => { setActive('Settings'); setSettingsSection('users') }}><span className="quick-icon blue"><ShieldCheck /></span><span><strong>Users & permissions</strong><small>Manage staff accounts and teacher access</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => { setActive('Settings'); setSettingsSection('backups') }}><span className="quick-icon orange"><Settings /></span><span><strong>Backups & restore</strong><small>Protect school records with regular backups</small></span><ArrowUpRight size={17} /></button>
                </div>
                <div className="panel quick-panel">
                  <div className="panel-heading"><div><h2>Quick actions</h2><p>Common school operations</p></div></div>
                  <button className="quick-action" onClick={() => setActive('Students')}><span className="quick-icon blue"><Plus /></span><span><strong>Manage students</strong><small>View student records</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => { setActive('Settings'); setSettingsSection('classes') }}><span className="quick-icon purple"><BookOpen /></span><span><strong>Manage classes</strong><small>Classes and streams in Settings</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Examinations')}><span className="quick-icon orange"><FileText /></span><span><strong>Examinations</strong><small>View exams and marks</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Leadership & Duty')}><span className="quick-icon purple"><ShieldCheck /></span><span><strong>Prefectorial body & duty roster</strong><small>Appoint student leaders and assign teachers on duty</small></span><ArrowUpRight size={17} /></button>
                </div>
              </section>
              <section className="panel overview-leadership">
                <div className="panel-heading"><div><h2>Student leadership & staff duty</h2><p>Keep student leadership appointments and teacher duty schedules organised.</p></div><button className="secondary-button" onClick={() => setActive('Leadership & Duty')}>Open management <ArrowUpRight size={15}/></button></div>
                <div className="overview-leadership-grid">
                  <button className="leadership-shortcut" onClick={() => setActive('Leadership & Duty')}><span className="quick-icon purple"><ShieldCheck /></span><span><strong>Prefectorial body</strong><small>Appoint head prefects, deputies and other student leaders; track their terms.</small></span><ArrowUpRight size={17}/></button>
                  <button className="leadership-shortcut" onClick={() => setActive('Leadership & Duty')}><span className="quick-icon blue"><CalendarDays /></span><span><strong>Teachers on duty</strong><small>Assign teaching staff to dates and keep a searchable duty history.</small></span><ArrowUpRight size={17}/></button>
                </div>
              </section>
            </>
          )}

          {active === 'Students' && (
            <section className="panel">
              <div className="panel-heading student-workspace-heading"><div><h2>Students</h2><p>{studentTotal.toLocaleString()} registered students · Select a class to view its student list.</p></div><button type="button" className="primary-button add-student-button" onClick={() => { setShowStudentForm(v => !v); setStudentError(''); setStudentSuccess('') }}><UserPlus size={16} /> {showStudentForm ? 'Close registration' : 'Register student'}</button></div>
              {studentSuccess && <div className="success-notice">{studentSuccess}</div>}
              {studentError && <div className="form-error">{studentError}</div>}
              {showStudentForm && (
                <form className="student-form registration-form" onSubmit={registerStudent}>
                  <div className="form-heading">
                    <div><h3>Register a new student</h3><p>Complete the sections below. Only the fields marked with * are compulsory.</p></div>
                    <span className="required-note">* Required</span>
                  </div>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Admission details</h4><p>Choose the class and confirm when the student is joining.</p></div></div>
                    <div className="student-form-grid">
                      <div className="generated-admission"><strong>Admission number</strong><span>Generated automatically when you save</span><b>{[admissionSettings.admission_prefix.trim(), ...(admissionSettings.include_year ? [String(new Date().getFullYear())] : []), String(admissionSettings.next_admission_number).padStart(admissionSettings.admission_padding, '0')].filter(Boolean).join(admissionSettings.admission_separator)}</b></div>
                      <label>Class *<select value={studentForm.class_id} onChange={e => setStudentForm({ ...studentForm, class_id: e.target.value, a_level_stream: '', combination: '', optional_subjects: '', subsidiary_subjects: '' })} required><option value="">Choose the student's class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` — ${item.section}` : ''}</option>)}</select></label>
                      <label>Admission date<input type="date" value={studentForm.admission_date} onChange={e => setStudentForm({ ...studentForm, admission_date: e.target.value })} /><small className="field-hint">Date the student officially joins the school.</small></label>
                      <label>Term fee (UGX)<input type="number" min="0" step="1" value={studentForm.fee_amount} onChange={e => setStudentForm({ ...studentForm, fee_amount: e.target.value })} placeholder="Automatically uses the class fee" /><small className="field-hint">Prefilled from the selected class and active term. You can adjust it if authorised.</small></label>
                    </div>
                  </section>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">02</span><div><h4>Biodata</h4><p>Enter the student's official names and personal details.</p></div></div>
                    <div className="student-form-grid">
                      <label className="field-span-full">Student full name *<input autoComplete="name" value={studentForm.full_name} onChange={e=>setStudentForm({...studentForm,full_name:e.target.value})} placeholder="Enter student's full name" required /></label>
                      <label>Gender<select value={studentForm.gender} onChange={e => setStudentForm({ ...studentForm, gender: e.target.value })}><option value="">Select gender</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></label>
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
                      <label>Parent / guardian name<input autoComplete="name" value={studentForm.guardian_name} onChange={e => setStudentForm({ ...studentForm, guardian_name: e.target.value })} placeholder="Full name" /></label>
                      <label>Relationship<select value={studentForm.guardian_relationship} onChange={e => setStudentForm({ ...studentForm, guardian_relationship: e.target.value })}><option value="">Select relationship</option><option>Parent</option><option>Guardian</option><option>Other relative</option></select></label>
                      <label>Guardian phone<input type="tel" autoComplete="tel" value={studentForm.guardian_phone} onChange={e => setStudentForm({ ...studentForm, guardian_phone: e.target.value })} placeholder="e.g. 07XX XXX XXX" /></label>
                    </div>
                  </section>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">04</span><div><h4>Previous education</h4><p>If the student is joining from another school, record it here.</p></div></div>
                    <div className="student-form-grid">
                      <label>Previous school<input value={studentForm.previous_school} onChange={e => setStudentForm({ ...studentForm, previous_school: e.target.value })} placeholder="Name of previous school (optional)" /></label>
                    </div>
                  </section>

                  {schoolConfig.school_type==='Secondary'&&selectedAcademicLevel==='A-Level'&&<section className="form-section"><div className="form-section-heading"><span className="form-section-number">05</span><div><h4>A-Level subject choices</h4><p>The selected class determines A-Level automatically. Choose Arts or Sciences, then its combinations.</p></div></div><div className="student-form-grid"><label>A-Level stream *<select required value={studentForm.a_level_stream} onChange={e=>setStudentForm({...studentForm,a_level_stream:e.target.value,combination:''})}><option value="">Choose Arts or Sciences</option><option value="Arts">Arts</option><option value="Sciences">Sciences</option></select></label>{studentForm.a_level_stream&&<label>Combination *<select required value={studentForm.combination} onChange={e=>setStudentForm({...studentForm,combination:e.target.value})}><option value="">Select combination</option>{(studentForm.a_level_stream==='Arts'?artsCombinations:sciencesCombinations).map((x:string)=><option key={x}>{x}</option>)}</select></label>}<label className="field-span-full">Subsidiary subjects<select multiple size={5} value={studentForm.subsidiary_subjects?studentForm.subsidiary_subjects.split(',').filter(Boolean):[]} onChange={e=>setStudentForm({...studentForm,subsidiary_subjects:Array.from(e.target.selectedOptions).map(o=>o.value).join(',')})}>{(schoolConfig.a_level_subsidiary_subjects||'').split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean).map((x:string)=><option key={x}>{x}</option>)}</select><small className="field-hint">Select more than one subsidiary subject using Ctrl/Command-click.</small></label></div></section>}{schoolConfig.school_type==='Secondary'&&selectedAcademicLevel==='O-Level'&&<section className="form-section"><div className="form-section-heading"><span className="form-section-number">05</span><div><h4>O-Level optional subjects</h4><p>The selected class determines O-Level automatically.</p></div></div><div className="student-form-grid"><label className="field-span-full">Optional subjects<select multiple size={5} value={studentForm.optional_subjects?studentForm.optional_subjects.split(',').filter(Boolean):[]} onChange={e=>setStudentForm({...studentForm,optional_subjects:Array.from(e.target.selectedOptions).map(o=>o.value).join(',')})}>{(schoolConfig.o_level_optional_subjects||'').split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean).map((x:string)=><option key={x}>{x}</option>)}</select><small className="field-hint">Select more than one optional subject using Ctrl/Command-click.</small></label></div></section>}
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
              <div className="student-search-panel"><div className="search-box"><Search size={19}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={studentClassFilter?'Search this class by student name or admission number...':'Search all students by name or admission number...'} aria-label="Search students by name or admission number"/></div><span>Search results update automatically</span></div>
              <div className="student-list-heading"><div><h3>{studentClassFilter ? (classes.find(item=>String(item.id)===studentClassFilter)?.name||'Selected class') : 'All students'}{studentClassFilter && classes.find(item=>String(item.id)===studentClassFilter)?.section ? ` · ${classes.find(item=>String(item.id)===studentClassFilter)?.section}` : ''}</h3><p>{studentTotal.toLocaleString()} matching student records</p></div></div><StudentTable students={filteredStudents} classes={classes} onSelect={id => void openStudentProfile(id)} />
              <div className="pagination-row"><span>Showing {students.length ? (studentPage - 1) * 25 + 1 : 0}–{Math.min(studentPage * 25, studentTotal)} of {studentTotal}</span><div><button className="secondary-button" disabled={studentPage <= 1} onClick={() => void loadStudentPage(studentPage - 1)}>Previous</button><button className="secondary-button" disabled={studentPage * 25 >= studentTotal} onClick={() => void loadStudentPage(studentPage + 1)}>Next</button></div></div>
            </section>
          )}



          <StaffFinance token={token} active={active} classes={classes} refreshKey={refreshKey} />
          {studentProfile && (
            <div className="modal-backdrop" onClick={()=>setStudentProfile(null)}>
              <section className="panel student-profile-modal" onClick={e=>e.stopPropagation()}>
                <div className="panel-heading"><div><h2>Student profile</h2><p>{studentProfile.student.admission_number} · {studentProfile.student.status}</p></div><div className="profile-actions"><button className="secondary-button" type="button" onClick={()=>void dismissStudent(studentProfile.student.id)} disabled={studentProfile.student.status==='dismissed'}>Dismiss student</button><button className="secondary-button" type="button" onClick={()=>setStudentProfile(null)}>Close</button></div></div>
                {profileMessage&&<div className="success-notice">{profileMessage}</div>}
                <details className="form-disclosure"><summary>Edit student details</summary><form className="student-form" onSubmit={saveStudentProfile}>
                  <div className="student-form-grid">
                    <label>First name<input required value={studentProfile.student.first_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,first_name:e.target.value}})}/></label>
                    <label>Middle name<input value={studentProfile.student.middle_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,middle_name:e.target.value}})}/></label>
                    <label>Last name<input required value={studentProfile.student.last_name||''} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,last_name:e.target.value}})}/></label>
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
                    <label>Student status<select value={studentProfile.student.status||'active'} onChange={e=>setStudentProfile({...studentProfile,student:{...studentProfile.student,status:e.target.value}})}><option value="active">Active</option><option value="transferred">Transferred</option><option value="dismissed">Dismissed</option><option value="inactive">Inactive</option></select></label>
                  </div>
                  <div className="form-actions"><button className="primary-button" disabled={profileSaving}>{profileSaving?'Saving...':'Save student profile'}</button></div>
                </form></details>
                <div className="panel-heading"><div><h3>Fee history</h3><p>All historic charges and payments for this student</p></div></div>
                <div className="stats-grid finance-stats"><div className="stat-card"><span>Total charged</span><strong className="stat-value">UGX {Number(studentProfile.total_charged||0).toLocaleString()}</strong></div><div className="stat-card"><span>Total paid</span><strong className="stat-value">UGX {Number(studentProfile.total_paid||0).toLocaleString()}</strong></div><div className="stat-card"><span>Balance</span><strong className="stat-value">UGX {Number(studentProfile.total_balance||0).toLocaleString()}</strong></div></div>
                <div className="table-wrap"><table><thead><tr><th>Term</th><th>Year</th><th>Charged</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{studentProfile.fees.map((fee:any)=><tr key={fee.charge_id}><td>{fee.term}</td><td>{fee.year}</td><td>{Number(fee.amount).toLocaleString()}</td><td>{Number(fee.paid).toLocaleString()}</td><td>{Number(fee.balance).toLocaleString()}</td></tr>)}</tbody></table></div>
                <div className="panel-heading"><div><h3>Payment history</h3><p>Individual payments and receipt references</p></div></div>
                <div className="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Term</th><th>Method</th><th>Amount (UGX)</th></tr></thead><tbody>{studentProfile.fees.flatMap((fee:any)=>fee.payments.map((payment:any)=><tr key={payment.id}><td>{payment.date}</td><td>{payment.receipt_number||payment.reference||'—'}</td><td>{fee.term} {fee.year}</td><td>{payment.method}</td><td>{Number(payment.amount).toLocaleString()}</td></tr>))}</tbody></table></div>
              </section>
            </div>
          )}
          {active === 'Examinations' && <ComingSoon title="Examinations and results" description="Exam setup, marks entry and student results will be managed here." />}
          {active === 'Leadership & Duty' && user.role === 'admin' && <LeadershipDuty token={token} />}
          {active === 'Settings' && settingsSection === 'home' && (
            <section className="settings-hub">
              <div className="panel-heading"><div><h2>School settings</h2><p>Choose a category to configure how SchoolBridge works for this school.</p></div></div>
              <div className="settings-category-grid">
                <button className="settings-category" onClick={() => setSettingsSection('school')}><span className="settings-category-icon"><GraduationCap /></span><strong>School Profile</strong><small>School name, contacts and identity</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('classes')}><span className="settings-category-icon"><BookOpen /></span><strong>Classes & Streams</strong><small>Create classes, streams and manage class fees</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('admission')}><span className="settings-category-icon"><Users /></span><strong>Admission Numbers</strong><small>Set the format for student admission numbers</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('academic')}><span className="settings-category-icon"><CalendarDays /></span><strong>Academic Year & Terms</strong><small>Set the active academic year and term</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('curriculum')}><span className="settings-category-icon"><BookOpen /></span><strong>Academic & Curriculum</strong><small>Configure A-Level combinations, O-Level optional and subsidiary subjects</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('users')}><span className="settings-category-icon"><ShieldCheck /></span><strong>Users & Permissions</strong><small>Administrator and teacher access</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('backups')}><span className="settings-category-icon"><Settings /></span><strong>Backups & Restore</strong><small>Protect and restore school records</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('audit')}><span className="settings-category-icon"><ShieldCheck /></span><strong>Audit Log</strong><small>Review important changes and financial actions</small><ArrowUpRight /></button>
              </div>
            </section>
          )}
          {active === 'Settings' && settingsSection !== 'home' && (
            <div className="settings-detail">
              <button className="settings-back" onClick={() => setSettingsSection('home')}>← All settings</button>
              {settingsSection === 'admission' && (
            <section className="panel settings-panel">
              <div className="panel-heading"><div><h2>Admission number settings</h2><p>Choose the format used for newly registered students at this school.</p></div></div>
              {settingsSuccess && <div className="success-notice">{settingsSuccess}</div>}
              {settingsError && <div className="form-error">{settingsError}</div>}
              <details className="form-disclosure"><summary>Edit admission number settings</summary><form className="student-form" onSubmit={saveAdmissionSettings}>
                <div className="student-form-grid">
                  <label>School prefix *<input required maxLength={20} value={admissionSettings.admission_prefix} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_prefix: e.target.value })} placeholder="e.g. KIS" /></label>
                  <label>Separator<select value={admissionSettings.admission_separator} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_separator: e.target.value })}><option value="-">Hyphen (-)</option><option value="/">Slash (/)</option><option value="">None</option></select></label>
                  <label>Number of digits<select value={admissionSettings.admission_padding} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_padding: Number(e.target.value) })}>{[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} digits</option>)}</select></label>
                  <label>Next sequence number<input type="number" min="1" value={admissionSettings.next_admission_number} onChange={e => setAdmissionSettings({ ...admissionSettings, next_admission_number: Math.max(1, Number(e.target.value)) })} required /></label>
                  <label className="settings-checkbox"><input type="checkbox" checked={admissionSettings.include_year} onChange={e => setAdmissionSettings({ ...admissionSettings, include_year: e.target.checked })} /> Include current year</label>
                </div>
                <div className="number-preview"><span>Example of next admission number</span><strong>{[admissionSettings.admission_prefix.trim(), ...(admissionSettings.include_year ? [String(new Date().getFullYear())] : []), String(admissionSettings.next_admission_number).padStart(admissionSettings.admission_padding, '0')].filter(Boolean).join(admissionSettings.admission_separator)}</strong></div>
                <p className="form-hint">These settings affect new registrations only. Existing admission numbers will not be changed.</p>
                <div className="form-actions"><button className="primary-button" disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save numbering settings'}</button></div>
              </form></details>
            </section>
              )}
              {settingsSection === 'school' && <SchoolProfileSettings token={token} onSaved={() => { api<any>('settings/school-profile',token).then(setSchoolConfig).catch(()=>{}); setSettingsSection('home') }} />}
              {settingsSection === 'academic' && <><AcademicSettings token={token} onSaved={() => setSettingsSection('home')} /><SubjectSettings token={token} onSaved={() => setSettingsSection('home')} /></>}
              {settingsSection === 'curriculum' && <AcademicCurriculumSettings token={token} onSaved={() => setSettingsSection('home')} />}
              {settingsSection === 'users' && <TeacherUsersSettings token={token} classes={classes} onSaved={() => setSettingsSection('home')} />}
              {settingsSection === 'backups' && <BackupSettings token={token} />}
              {settingsSection === 'audit' && <AuditLogSettings token={token} />}
            </div>
          )}
          {active === 'Settings' && settingsSection === 'classes' && (
            <section className="panel">
              <div className="panel-heading"><div><h2>School classes</h2><p>Classes registered in the system</p></div><button className="primary-button add-student-button" onClick={() => { setShowClassForm(v => !v); setClassError(''); setClassSuccess(''); if (!showClassForm) { setClassForm({ name: '', section: '' }) } }}><Plus size={16} /> {showClassForm ? 'Close form' : 'Add class'}</button></div>
              {classSuccess && <div className="success-notice">{classSuccess}</div>}
              {classError && <div className="form-error">{classError}</div>}
              {showClassForm && <form className="student-form class-form" onSubmit={registerClass}><div className="form-heading"><div><h3>Create a school class</h3><p>Choose a class for the school type saved in School Profile. A stream is optional.</p></div></div><div className="student-form-grid class-form-grid"><label>Class name *<select required value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })}><option value="">Choose a class</option>{((schoolConfig.school_type || 'Primary') === 'Primary' ? Array.from({length:7},(_,i)=>'Primary '+(i+1)) : Array.from({length:6},(_,i)=>'Senior '+(i+1))).map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>Stream (optional)<input value={classForm.section} onChange={e => setClassForm({ ...classForm, section: e.target.value })} placeholder="e.g. East, A, Arts or Sciences" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowClassForm(false)}>Cancel</button><button className="primary-button" disabled={savingClass || !classForm.name.trim()}>{savingClass ? 'Saving...' : 'Save class'}</button></div></form>}
              <div className="class-grid">{classes.map(item => <div className="class-card" key={item.id}><BookOpen size={22} /><strong>{item.name}</strong><span>{item.section || 'No stream'}</span><button type="button" className="secondary-button" disabled={deletingClassId===item.id} onClick={() => void deleteClass(item)}>{deletingClassId===item.id ? 'Removing...' : 'Remove class'}</button></div>)}</div>
              {classes.length === 0 && <EmptyState text="No classes have been added yet." />}
            </section>
          )}

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
      {students.map(student => <tr key={student.id} className="clickable-row" onClick={()=>onSelect(student.id)}><td><div className="student-cell"><div className="student-avatar">{(student.first_name || '?').slice(0, 1).toUpperCase()}</div><strong>{student.first_name} {student.last_name}</strong></div></td><td>{student.admission_number}</td><td>{student.gender || '—'}</td><td>{classes.find(item => item.id === student.class_id) ? (classes.find(item => item.id === student.class_id)?.name + (classes.find(item => item.id === student.class_id)?.section ? ' — ' + classes.find(item => item.id === student.class_id)?.section : '')) : '—'}</td></tr>)}
    </tbody></table></div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><GraduationCap size={30} /><p>{text}</p></div>
}

function ComingSoon({ title, description }: { title: string; description: string }) {
  return <section className="panel coming-soon"><div className="coming-icon"><Settings size={28} /></div><h2>{title}</h2><p>{description}</p><span>Module in development</span></section>
}

export default App


function AcademicSettings({token,onSaved}:{token:string;onSaved:()=>void}) {
  const [year,setYear]=useState(new Date().getFullYear())
  const [term,setTerm]=useState('Term 1')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api<{academic_year:number;active_term:string}>('settings/academic',token).then(x=>{setYear(x.academic_year);setTerm(x.active_term)}).catch(e=>setMessage(e.message))},[token])
  async function save(e:React.FormEvent) {e.preventDefault();setBusy(true);setMessage('');try{await api('settings/academic',token,{method:'PUT',body:JSON.stringify({academic_year:year,active_term:term})});setMessage('Active academic year and term saved. New registrations will use this term.');onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to save academic settings.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Academic year and active term</h2><p>These settings determine which class fee is assigned to new students.</p></div></div>{message&&<div className="success-notice">{message}</div>}<details className="form-disclosure"><summary>Edit academic year and active term</summary><form className="student-form" onSubmit={save}><div className="student-form-grid"><label>Academic year *<input required type="number" min="2000" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))}/></label><label>Active term *<select required value={term} onChange={e=>setTerm(e.target.value)}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save academic settings'}</button></div></form></details></section>
}

type TeacherAssignment = {assignment_id:number;class_id:number;class:string;subject:string}
type TeacherStudent = {id:number;first_name:string;last_name:string;admission_number:string;class_id:number}
function TeacherWorkspace({token,active}:{token:string;active:string}) {
  const [assignments,setAssignments]=useState<TeacherAssignment[]>([])
  const [students,setStudents]=useState<TeacherStudent[]>([])
  const [classId,setClassId]=useState('')
  const [statuses,setStatuses]=useState<Record<number,string>>({})
  const [attendanceDate,setAttendanceDate]=useState(new Date().toISOString().slice(0,10))
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState<number|null>(null)
  useEffect(()=>{api<TeacherAssignment[]>('teacher/my-assignments',token).then(rows=>{setAssignments(rows);if(rows.length)setClassId(String(rows[0].class_id))}).catch(e=>setMessage(e.message))},[token])
  useEffect(()=>{if(active!=='Attendance'||!classId)return;api<TeacherStudent[]>('teacher/students?class_id='+classId,token).then(setStudents).catch(e=>setMessage(e.message))},[active,classId,token])
  async function record(student:TeacherStudent) {setBusy(student.id);setMessage('');try{await api('teacher/attendance',token,{method:'POST',body:JSON.stringify({student_id:student.id,attendance_date:attendanceDate,status:statuses[student.id]||'Present'})});setMessage('Attendance saved for '+student.first_name+' '+student.last_name+'.')}catch(e){setMessage(e instanceof Error?e.message:'Unable to save attendance.')}finally{setBusy(null)}}
  if(active==='My Classes') return <section className="panel"><div className="panel-heading"><div><h2>My assigned classes</h2><p>Only classes and subjects assigned to your teacher account appear here.</p></div></div>{message&&<div className="notice">{message}</div>}<div className="class-grid">{assignments.map(a=><div className="class-card" key={a.assignment_id}><BookOpen size={22}/><strong>{a.class}</strong><span>{a.subject}</span></div>)}</div>{!assignments.length&&<div className="empty-state"><GraduationCap size={30}/><p>No classes have been assigned to your account yet.</p></div>}</section>
  return <section className="panel"><div className="panel-heading"><div><h2>Class attendance</h2><p>Record attendance for students in your assigned classes.</p></div></div>{message&&<div className="notice">{message}</div>}<div className="student-form-grid"><label>Assigned class<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Choose class</option>{assignments.map(a=><option key={a.assignment_id} value={a.class_id}>{a.class} — {a.subject}</option>)}</select></label><label>Attendance date<input type="date" value={attendanceDate} onChange={e=>setAttendanceDate(e.target.value)}/></label></div><div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission number</th><th>Status</th><th>Action</th></tr></thead><tbody>{students.map(student=><tr key={student.id}><td>{student.first_name} {student.last_name}</td><td>{student.admission_number}</td><td><select value={statuses[student.id]||'Present'} onChange={e=>setStatuses(old=>({...old,[student.id]:e.target.value}))}><option>Present</option><option>Absent</option><option>Late</option><option>Excused</option></select></td><td><button className="primary-button" disabled={busy===student.id} onClick={()=>void record(student)}>{busy===student.id?'Saving...':'Save'}</button></td></tr>)}</tbody></table></div>{!students.length&&<div className="empty-state"><Users size={30}/><p>Select one of your assigned classes to load its active students.</p></div>}</section>
}
function SchoolProfileSettings({token,onSaved}:{token:string;onSaved:()=>void}) {
  const [form,setForm]=useState({name:'My School',address:'',phone:'',email:'',motto:'',school_type:'Secondary',a_level_combinations:'',o_level_optional_subjects:'',a_level_subsidiary_subjects:''})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api<any>('settings/school-profile',token).then(p=>setForm({name:p.name||'My School',address:p.address||'',phone:p.phone||'',email:p.email||'',motto:p.motto||'',school_type:p.school_type||'Secondary',a_level_combinations:p.a_level_combinations||'',o_level_optional_subjects:p.o_level_optional_subjects||'',a_level_subsidiary_subjects:p.a_level_subsidiary_subjects||''})).catch(e=>setMessage(e.message))},[token])
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('settings/school-profile',token,{method:'PUT',body:JSON.stringify({...form,address:form.address||null,phone:form.phone||null,email:form.email||null,motto:form.motto||null})});setMessage('School profile saved. Student registration will now follow this school type.');onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to save school profile.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>School profile</h2><p>Set the identity, contact information and school category used throughout SchoolBridge.</p></div></div>{message&&<div className="success-notice">{message}</div>}<form className="student-form" onSubmit={save}><div className="student-form-grid"><label>School name *<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>School type *<select required value={form.school_type} onChange={e=>setForm({...form,school_type:e.target.value})}><option>Primary</option><option>Secondary</option></select><small className="field-hint">Primary schools will not be shown secondary-level academic options during registration.</small></label><label>Phone number<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Email address<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Address<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label><label>School motto<input value={form.motto} onChange={e=>setForm({...form,motto:e.target.value})}/></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save school profile'}</button></div></form></section>
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
  const [subjects,setSubjects]=useState<any[]>([])
  const [teacher,setTeacher]=useState({username:'',email:'',password:''})
  const [assignment,setAssignment]=useState({teacher_id:'',class_id:'',subject_id:''})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function load(){try{const [u,sub]=await Promise.all([api<any[]>('auth/users',token),api<any[]>('subjects',token)]);setUsers(u);setSubjects(sub)}catch(e){setMessage(e instanceof Error?e.message:'Unable to load user settings.')}}
  useEffect(()=>{void load()},[token])
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('auth/teachers',token,{method:'POST',body:JSON.stringify(teacher)});setTeacher({username:'',email:'',password:''});setMessage('Teacher account created.');await load();onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to create account.')}finally{setBusy(false)}}
  async function assign(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('teacher-assignments',token,{method:'POST',body:JSON.stringify({teacher_id:Number(assignment.teacher_id),class_id:Number(assignment.class_id),subject_id:Number(assignment.subject_id)})});setMessage('Teacher assignment saved.');setAssignment({teacher_id:'',class_id:'',subject_id:''});onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to assign teacher.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Users and permissions</h2><p>Create teacher accounts and restrict their workspace to assigned classes and subjects.</p></div></div>{message&&<div className="success-notice">{message}</div>}<h3>Create teacher account</h3><details className="form-disclosure"><summary>Create teacher account</summary><form className="student-form" onSubmit={create}><div className="student-form-grid"><label>Username *<input required value={teacher.username} onChange={e=>setTeacher({...teacher,username:e.target.value})}/></label><label>Email *<input required type="email" value={teacher.email} onChange={e=>setTeacher({...teacher,email:e.target.value})}/></label><label>Temporary password *<input required type="password" minLength={12} value={teacher.password} onChange={e=>setTeacher({...teacher,password:e.target.value})}/></label></div><p className="form-hint">Use a strong password of at least 12 characters and share it securely with the teacher.</p><div className="form-actions"><button className="primary-button" disabled={busy}>Create teacher account</button></div></form></details><h3>Assign classes and subjects</h3><details className="form-disclosure"><summary>Assign teacher classes and subjects</summary><form className="student-form" onSubmit={assign}><div className="student-form-grid"><label>Teacher<select required value={assignment.teacher_id} onChange={e=>setAssignment({...assignment,teacher_id:e.target.value})}><option value="">Select teacher</option>{users.filter(u=>u.role==='teacher'&&u.active).map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select></label><label>Class<select required value={assignment.class_id} onChange={e=>setAssignment({...assignment,class_id:e.target.value})}><option value="">Select class</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}{c.section?' — '+c.section:''}</option>)}</select></label><label>Subject<select required value={assignment.subject_id} onChange={e=>setAssignment({...assignment,subject_id:e.target.value})}><option value="">Select subject</option>{subjects.map(sub=><option key={sub.id} value={sub.id}>{sub.name}</option>)}</select></label></div><div className="form-actions"><button className="primary-button" disabled={busy||!subjects.length||!classes.length}>Save teacher assignment</button></div></form></details><h3>School user accounts</h3><div className="table-wrap"><table><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.username}</td><td>{u.email}</td><td>{u.role}</td><td>{u.active?'Active':'Disabled'}</td></tr>)}</tbody></table></div></section>
}

function BackupSettings({token}:{token:string}) {
  const [file,setFile]=useState<File|null>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function createBackup(){
    setBusy(true);setMessage('')
    try {const response=await fetch(`${API_BASE_URL}/api/backups/create`,{method:'POST',headers:{Authorization:'Bearer '+token}});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||'Backup failed')}const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='schoolbridge-backup-'+new Date().toISOString().slice(0,10)+'.sqlite3';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);setMessage('Database backup created and downloaded. Keep a copy somewhere safe.')}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to create backup.')}finally{setBusy(false)}
  }
  async function restoreBackup(){
    if(!file)return
    if(!window.confirm('Restore this backup? Current school data will be replaced. A safety copy of the current database will be kept.'))return
    setBusy(true);setMessage('')
    try {const body=new FormData();body.append('file',file);const response=await fetch(`${API_BASE_URL}/api/backups/restore`,{method:'POST',headers:{Authorization:'Bearer '+token},body});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'Restore failed');setMessage(data.message||'Restore staged. Restart the backend to complete it.');setFile(null)}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to restore backup.')}finally{setBusy(false)}
  }
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Backups and restore</h2><p>Download a copy of the local school database or restore from a previous SchoolBridge backup.</p></div></div>{message&&<div className="success-notice">{message}</div>}<div className="backup-action"><h3>Create a backup</h3><p>Includes student, staff, academic, fee, payment and settings records.</p><button className="primary-button" type="button" disabled={busy} onClick={()=>void createBackup()}>{busy?'Working...':'Create and download backup'}</button></div><div className="backup-action"><h3>Restore a backup</h3><p>Only restore a valid SchoolBridge SQLite backup. The current database is copied to a safety file before restoration.</p><label>Select backup file<input type="file" accept=".sqlite,.sqlite3,.db" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><div className="form-actions"><button className="secondary-button" type="button" disabled={!file||busy} onClick={()=>void restoreBackup()}>{busy?'Restoring...':'Restore selected backup'}</button></div></div><p className="form-hint">For PostgreSQL multi-computer installations, use the database administrator's backup procedure. File-based backup and restore here applies to the local SQLite installation.</p></section>
}

function AuditLogSettings({token}:{token:string}) {
  const [items,setItems]=useState<any[]>([])
  const [message,setMessage]=useState('')
  useEffect(()=>{api<{items:any[]}>('audit-logs?page=1&page_size=100',token).then(r=>setItems(r.items)).catch(e=>setMessage(e.message))},[token])
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Audit log</h2><p>Recent administrator actions, financial entries and profile changes. Financial records are retained rather than silently deleted.</p></div></div>{message&&<div className="form-error">{message}</div>}<div className="table-wrap"><table><thead><tr><th>Date and time</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.actor_username}</td><td>{item.action}</td><td>{item.entity_type} #{item.entity_id}</td><td>{item.details||'—'}</td></tr>)}</tbody></table></div>{!items.length&&!message&&<div className="empty-state"><ShieldCheck size={30}/><p>No audit events have been recorded yet.</p></div>}</section>
}

function SubjectSettings({token,onSaved}:{token:string;onSaved:()=>void}) {
  const [subjects,setSubjects]=useState<any[]>([])
  const [name,setName]=useState('')
  const [code,setCode]=useState('')
  const [message,setMessage]=useState('')
  async function load(){try{setSubjects(await api<any[]>('subjects',token))}catch(e){setMessage(e instanceof Error?e.message:'Unable to load subjects.')}}
  useEffect(()=>{void load()},[token])
  async function add(e:React.FormEvent){e.preventDefault();setMessage('');try{await api('subjects',token,{method:'POST',body:JSON.stringify({name:name.trim(),code:code.trim()||null})});setName('');setCode('');setMessage('Subject added.');await load();onSaved()}catch(e){setMessage(e instanceof Error?e.message:'Unable to add subject.')}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>School subjects</h2><p>Manage subjects used for examinations and teacher assignments.</p></div></div>{message&&<div className="success-notice">{message}</div>}<details className="form-disclosure"><summary>Add a school subject</summary><form className="student-form" onSubmit={add}><div className="student-form-grid"><label>Subject name *<input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Mathematics"/></label><label>Subject code<input value={code} onChange={e=>setCode(e.target.value)} placeholder="Optional code"/></label></div><div className="form-actions"><button className="primary-button">Add subject</button></div></form></details><div className="table-wrap"><table><thead><tr><th>Subject</th><th>Code</th></tr></thead><tbody>{subjects.map(subject=><tr key={subject.id}><td>{subject.name}</td><td>{subject.code||'—'}</td></tr>)}</tbody></table></div></section>
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

  async function loadAll() {
    const [p,d,s,t]=await Promise.all([
      api<PrefectRow[]>('leadership/prefects?active_only=false',token),
      api<DutyRow[]>('leadership/teacher-duties',token),
      api<{items:LeadershipStudent[]}>('students/search?page=1&page_size=100&search='+encodeURIComponent(studentSearch),token),
      api<{items:LeadershipStaff[]}>('staff?page=1&page_size=100&category=Teaching',token),
    ])
    setPrefects(p);setDuties(d);setStudents(s.items);setStaff(t.items.filter(x=>x.status==='active'))
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
    setError('');setMessage('')
    try {await api('leadership/prefects/'+id+'/end',token,{method:'PATCH'});setMessage('Prefect appointment ended.');await loadAll()}
    catch(e){setError(e instanceof Error?e.message:'Unable to update prefect appointment.')}
  }
  async function removeDuty(id:number) {
    if(!window.confirm('Remove this duty assignment?'))return
    setError('');setMessage('')
    try {await api('leadership/teacher-duties/'+id,token,{method:'DELETE'});setMessage('Duty assignment removed.');await loadAll()}
    catch(e){setError(e instanceof Error?e.message:'Unable to remove duty assignment.')}
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
    {message&&<div className="success-notice">{message}</div>}
    {error&&<div className="form-error">{error}</div>}
    <section className="panel">
      <div className="panel-heading"><div><h2>Prefectorial body</h2><p>Appoint student leaders and keep track of their service terms.</p></div></div>
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
      <div className="table-wrap"><table><thead><tr><th>Position</th><th>Student</th><th>Admission no.</th><th>Class</th><th>Term</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {prefects.map(p=><tr key={p.id}><td>{p.position}</td><td>{p.student_name}</td><td>{p.admission_number}</td><td>{p.class_name}{p.stream?' · '+p.stream:''}</td><td>{p.start_date}{p.end_date?' – '+p.end_date:''}</td><td>{p.active?'Active':'Ended'}</td><td>{p.active&&<button className="secondary-button" type="button" onClick={()=>void endAppointment(p.id)}>End term</button>}</td></tr>)}
        {!prefects.length&&<tr><td colSpan={7}>No prefect appointments recorded yet.</td></tr>}
      </tbody></table></div>
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
      <div className="table-wrap"><table><thead><tr><th>Duty date</th><th>Teacher</th><th>Staff no.</th><th>Notes / duty area</th><th>Action</th></tr></thead><tbody>
        {duties.map(d=><tr key={d.id}><td>{d.duty_date}</td><td>{d.teacher_name}</td><td>{d.staff_number}</td><td>{d.notes||'—'}</td><td><button className="secondary-button" type="button" onClick={()=>void removeDuty(d.id)}>Remove</button></td></tr>)}
        {!duties.length&&<tr><td colSpan={5}>No teacher duty assignments recorded yet.</td></tr>}
      </tbody></table></div>
    </section>
  </div>
}
