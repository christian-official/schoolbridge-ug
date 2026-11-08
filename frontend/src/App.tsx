import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  FileText, Settings, LogOut,
  Search, Plus, Menu, X, ArrowUpRight, UserPlus,
  CalendarDays, TrendingUp, ShieldCheck, LoaderCircle, RefreshCw,
} from 'lucide-react'
import StaffFinance from './StaffFinance'
import AcademicManagement from './AcademicManagement'
import AttendanceManagement from './AttendanceManagement'
import OperationsManagement from './OperationsManagement'
import Phase4Workspace from './Phase4Workspace'
import './App.css'

type User = {
  id: number
  username: string
  email: string
  role: string
  role_label?: string
  permissions?: Record<string, string[]>
  active: boolean
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
}

const menu = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Students', icon: GraduationCap },
  { label: 'Staff', icon: Users },
  { label: 'Fees & Finance', icon: FileText },
  { label: 'Examinations', icon: FileText },
  { label: 'Attendance', icon: CalendarDays },
  { label: 'Staff Attendance', icon: Users },
  { label: 'Timetable', icon: CalendarDays },
  { label: 'Leadership & Duty', icon: ShieldCheck },
  { label: 'Parent Access', icon: Users },
  { label: 'Announcements', icon: FileText },
]
const teacherMenu = [
  { label: 'My Classes', icon: BookOpen },
  { label: 'Attendance', icon: CalendarDays },
  { label: 'My Attendance', icon: Users },
  { label: 'My Results', icon: FileText },
  { label: 'Announcements', icon: FileText },
]
const parentMenu = [
  { label: 'My Children', icon: GraduationCap },
  { label: 'Announcements', icon: FileText },
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

  useEffect(()=>{if(token && user?.role==='admin')api<any>('settings/school-profile',token).then(setSchoolConfig).catch(()=>{})},[token,user?.role])

  async function loadSchoolData(authToken: string, profile: User | null = user) {
    setDataError('')
    const isAdmin = profile?.role === 'admin'
    const allowed = (section:string) => isAdmin || (profile?.permissions?.[section] || []).includes('view')
    const canLoadStudents = allowed('Students')
    const canLoadClasses = canLoadStudents || allowed('Timetable') || allowed('Examinations') || allowed('Attendance')
    const jobs: Promise<any>[] = [
      canLoadStudents ? api<StudentPage>('students/search?page=1&page_size=25', authToken) : Promise.resolve(null),
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
      !studentForm.guardian_phone.trim() ? 'Guardian phone number' : '',
      schoolConfig.school_type === 'Secondary' && selectedAcademicLevel === 'A-Level' && !studentForm.a_level_stream ? 'A-Level stream' : '',
      schoolConfig.school_type === 'Secondary' && selectedAcademicLevel === 'A-Level' && !studentForm.combination ? 'A-Level combination' : '',
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
      else if(profile.role==='parent') setActive('My Children')
      else if(profile.role==='admin') await loadSchoolData(authToken,profile)
      else {
        const allowedItems = [...menu, ...teacherMenu.filter(item => !menu.some(base => base.label === item.label))].filter(item => (profile.permissions?.[item.label] || []).includes('view'))
        setActive(allowedItems[0]?.label || 'Overview')
        await loadSchoolData(authToken,profile)
      }
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
          {(user.role === 'parent' ? parentMenu : user.role === 'admin' ? menu : [...menu, ...teacherMenu.filter(item => !menu.some(base => base.label === item.label))].filter(item => (user.permissions?.[item.label] || []).includes('view'))).map(item => {
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

          {(active === 'My Classes' || active === 'Attendance' || active === 'My Attendance' || active === 'My Results') && user.role === 'teacher' && <TeacherWorkspace token={token} active={active} />}
          {((active === 'Parent Access' || active === 'Announcements') && user.role !== 'parent' || (active === 'My Children' || active === 'Announcements') && user.role === 'parent') && <Phase4Workspace token={token} role={user.role} active={active} permissions={user.permissions} />}

          {active === 'Overview' && (
            <>
              <section className="stats-grid">
                <StatCard title="Total students" value={studentTotal} icon={<GraduationCap />} note="All registered students" />
                <StatCard title="Students present" value={dashboardSummary.students_present_today} icon={<UserPlus />} note="Marked present today" />
                <StatCard title="Active staff" value={dashboardSummary.active_staff} icon={<Users />} note="Teaching and non-teaching" />
                <StatCard title="Total classes" value={dashboardSummary.total_classes} icon={<BookOpen />} note="Classes and streams" />
              </section>
              <section className="dashboard-grid overview-workflow-grid">
                <div className="panel quick-panel">
                  <div className="panel-heading"><div><h2>Academic & finance centre</h2><p>Priority school controls, collections and fee follow-up.</p></div></div>
                  <div className="overview-finance-metrics"><div><small>PAYMENTS RECEIVED</small><strong>UGX {financeDashboard.fees_collected.toLocaleString('en-UG')}</strong></div><div><small>OUTSTANDING BALANCES</small><strong>UGX {financeDashboard.outstanding.toLocaleString('en-UG')}</strong></div></div>
                  <button className="quick-action" onClick={() => setActive('Examinations')}><span className="quick-icon orange"><FileText /></span><span><strong>Enter and verify assessment marks</strong><small>Open subject registers, class performance and report cards.</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => { setFinanceTabRequest('payments'); setActive('Fees & Finance') }}><span className="quick-icon blue"><ShieldCheck /></span><span><strong>Record student payments</strong><small>Post collections and issue payment receipts.</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => { setFinanceTabRequest('balances'); setActive('Fees & Finance') }}><span className="quick-icon purple"><FileText /></span><span><strong>Outstanding fee balances</strong><small>Identify unpaid charges and follow up by class.</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Timetable')}><span className="quick-icon purple"><BookOpen /></span><span><strong>Review whole-school timetable</strong><small>Check lesson allocation by class, day and teacher.</small></span><ArrowUpRight size={17} /></button>
                </div>
                <div className="panel quick-panel">
                  <div className="panel-heading"><div><h2>Daily registers</h2><p>Complete the records that keep today’s operations accurate.</p></div></div>
                  <button className="quick-action" onClick={() => setActive('Attendance')}><span className="quick-icon blue"><CalendarDays /></span><span><strong>Record class attendance</strong><small>Mark students present, absent or late for each class.</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Staff Attendance')}><span className="quick-icon purple"><Users /></span><span><strong>Complete staff daily register</strong><small>Review teaching and non-teaching staff attendance and unmarked records.</small></span><ArrowUpRight size={17} /></button>
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
                    <div><h3>Register a new student</h3><p>Complete the sections below. Compulsory fields are full name, class, gender, parent/guardian name and guardian phone. Other details are optional unless required by the selected class.</p></div>
                    <span className="required-note">* Required</span>
                  </div>

                  <section className="form-section">
                    <div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Admission details</h4><p>Choose the class and confirm when the student is joining.</p></div></div>
                    <div className="student-form-grid">
                      <div className="generated-admission"><strong>Admission number</strong><span>Generated automatically when you save</span><b>{[admissionSettings.admission_prefix.trim(), ...(admissionSettings.include_year ? [String(new Date().getFullYear())] : []), String(admissionSettings.next_admission_number).padStart(admissionSettings.admission_padding, '0')].filter(Boolean).join(admissionSettings.admission_separator)}</b></div>
                      <label>Class *<select required value={studentForm.class_id} onChange={e => setStudentForm({ ...studentForm, class_id: e.target.value, a_level_stream: '', combination: '', optional_subjects: '', subsidiary_subjects: '' })}><option value="">Choose the student's class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` — ${item.section}` : ''}</option>)}</select></label>
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
                      <label>Guardian phone *<input required type="tel" autoComplete="tel" value={studentForm.guardian_phone} onChange={e => setStudentForm({ ...studentForm, guardian_phone: e.target.value })} placeholder="e.g. 07XX XXX XXX" /></label>
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



          <StaffFinance token={token} active={active} classes={classes} refreshKey={refreshKey} initialTab={financeTabRequest} />
          {studentProfile && (
            <div className="modal-backdrop" onClick={()=>setStudentProfile(null)}>
              <section className="panel student-profile-modal" onClick={e=>e.stopPropagation()}>
                <div className="panel-heading"><div><h2>Student profile</h2><p>{studentProfile.student.admission_number} · {studentProfile.student.status}</p></div><div className="profile-actions"><button className="secondary-button" type="button" onClick={()=>void dismissStudent(studentProfile.student.id)} disabled={studentProfile.student.status==='dismissed'}>Dismiss student</button><button className="secondary-button" type="button" onClick={()=>setStudentProfile(null)}>Close</button></div></div>
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
                    <div><small>Guardian phone</small><strong>{studentProfile.student.guardian_phone||'—'}</strong></div>
                  </div>
                  <div className="panel-heading"><div><h3>Previous education</h3></div></div>
                  <div className="student-form-grid">
                    <div><small>Previous school</small><strong>{studentProfile.student.previous_school||'—'}</strong></div>
                    <div><small>Academic level</small><strong>{studentProfile.student.academic_level||'—'}</strong></div>
                    <div><small>Combination / subjects</small><strong>{studentProfile.student.combination||studentProfile.student.optional_subjects||'—'}</strong></div>
                  </div>
                </section>
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
          {active === 'Examinations' && user.role !== 'parent' && <AcademicManagement token={token} classes={classes} />}
          {active === 'Attendance' && user.role !== 'parent' && user.role !== 'teacher' && <AttendanceManagement token={token} />}
          {(active === 'Staff Attendance' || active === 'Timetable') && user.role !== 'parent' && <OperationsManagement token={token} active={active} />}
          {active === 'Leadership & Duty' && user.role !== 'parent' && <LeadershipDuty token={token} />}
          {active === 'Settings' && settingsSection === 'home' && (
            <section className="settings-hub">
              <div className="panel-heading"><div><h2>School settings</h2><p>Choose a category to configure how SchoolBridge works for this school.</p></div></div>
              <div className="settings-category-grid">
                <button className="settings-category" onClick={() => setSettingsSection('school')}><span className="settings-category-icon"><GraduationCap /></span><strong>School Profile</strong><small>School name, contacts and identity</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('classes')}><span className="settings-category-icon"><BookOpen /></span><strong>Classes & Streams</strong><small>Create classes, streams and manage class fees</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('admission')}><span className="settings-category-icon"><Users /></span><strong>Admission Numbers</strong><small>Set the format for student admission numbers</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('academic')}><span className="settings-category-icon"><CalendarDays /></span><strong>Academic Year & Terms</strong><small>Set the active academic year and term</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('curriculum')}><span className="settings-category-icon"><BookOpen /></span><strong>Academic & Curriculum</strong><small>Configure A-Level combinations, O-Level optional and subsidiary subjects</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('users')}><span className="settings-category-icon"><ShieldCheck /></span><strong>Users & Permissions</strong><small>Teaching and non-teaching staff roles, tabs and actions</small><ArrowUpRight /></button>
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
              {settingsSuccess && <div className="success-notice" role="status">{settingsSuccess}</div>}
              {settingsError && <div className="form-error" role="alert">{settingsError}</div>}
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
              {settingsSection === 'academic' && <><AcademicSettings token={token} onSaved={() => setSettingsSection('home')} /><SubjectSettings token={token} schoolType={schoolConfig.school_type === 'Secondary' ? 'Secondary' : 'Primary'} /></>}
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

type TeacherAssignment = {assignment_id:number;class_id:number;class:string;subject_id:number;subject:string}
type TeacherStudent = {id:number;first_name:string;last_name:string;admission_number:string;class_id:number}
type TeacherExam = {id:number;name:string;term:string;year:number;class_id:number|null}
type TeacherMark = {id:number;student_id:number;subject_id:number;exam_id:number;score:number;verified:boolean;student_name:string;admission_number:string;class_id:number|null}
type TeacherOwnAttendance = {staff_name:string;staff_number:string;records:{id:number;attendance_date:string;status:string;notes?:string|null}[]}

function TeacherWorkspace({token,active}:{token:string;active:string}) {
  const [assignments,setAssignments]=useState<TeacherAssignment[]>([])
  const [students,setStudents]=useState<TeacherStudent[]>([])
  const [classId,setClassId]=useState('')
  const [statuses,setStatuses]=useState<Record<number,string>>({})
  const [attendanceDate,setAttendanceDate]=useState(new Date().toISOString().slice(0,10))
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState<number|null>(null)
  const [teacherExams,setTeacherExams]=useState<TeacherExam[]>([])
  const [examId,setExamId]=useState('')
  const [resultStudents,setResultStudents]=useState<TeacherStudent[]>([])
  const [resultMarks,setResultMarks]=useState<TeacherMark[]>([])
  const [resultForm,setResultForm]=useState({student_id:'',subject_id:'',score:''})
  const [resultMessage,setResultMessage]=useState('')
  const [resultError,setResultError]=useState('')
  const [resultSaving,setResultSaving]=useState(false)
  const [ownAttendance,setOwnAttendance]=useState<TeacherOwnAttendance|null>(null)
  const [ownAttendanceError,setOwnAttendanceError]=useState('')
  const [ownAttendanceLoading,setOwnAttendanceLoading]=useState(false)

  useEffect(()=>{api<TeacherAssignment[]>('teacher/my-assignments',token).then(rows=>{setAssignments(rows);if(rows.length)setClassId(String(rows[0].class_id))}).catch(e=>setMessage(e.message))},[token])
  useEffect(()=>{if(active!=='Attendance'||!classId)return;api<TeacherStudent[]>('teacher/students?class_id='+classId,token).then(setStudents).catch(e=>setMessage(e.message))},[active,classId,token])
  useEffect(()=>{
    if(active!=='My Results')return
    api<TeacherExam[]>('teacher/exams',token).then(rows=>{
      setTeacherExams(rows)
      if(rows.length)setExamId(String(rows[0].id))
      else setExamId('')
    }).catch(e=>setResultError(e.message))
  },[active,token])
  useEffect(()=>{
    if(active!=='My Attendance')return
    let cancelled=false
    setOwnAttendanceLoading(true)
    setOwnAttendanceError('')
    api<TeacherOwnAttendance>('teacher/my-staff-attendance',token).then(data=>{
      if(!cancelled)setOwnAttendance(data)
    }).catch(error=>{
      if(!cancelled){setOwnAttendance(null);setOwnAttendanceError(error instanceof Error?error.message:'Unable to load your attendance records.')}
    }).finally(()=>{if(!cancelled)setOwnAttendanceLoading(false)})
    return ()=>{cancelled=true}
  },[active,token])
    const selectedTeacherExam=teacherExams.find(exam=>String(exam.id)===examId)||null
  const assignedSubjects=assignments.filter(row=>row.class_id===selectedTeacherExam?.class_id)
  useEffect(()=>{
    if(active!=='My Results'||!selectedTeacherExam){setResultStudents([]);setResultMarks([]);return}
    let cancelled=false
    setResultError('')
    Promise.all([
      api<TeacherStudent[]>('teacher/students?class_id='+selectedTeacherExam.class_id,token),
      api<TeacherMark[]>('teacher/marks?exam_id='+selectedTeacherExam.id,token),
    ]).then(([studentRows,markRows])=>{
      if(cancelled)return
      setResultStudents(studentRows)
      setResultMarks(markRows)
    }).catch(e=>{if(!cancelled)setResultError(e.message)})
    return ()=>{cancelled=true}
  },[active,examId,selectedTeacherExam?.class_id,token])
  async function record(student:TeacherStudent) {setBusy(student.id);setMessage('');try{await api('teacher/attendance',token,{method:'POST',body:JSON.stringify({student_id:student.id,attendance_date:attendanceDate,status:statuses[student.id]||'Present'})});setMessage('Attendance saved for '+student.first_name+' '+student.last_name+'.')}catch(e){setMessage(e instanceof Error?e.message:'Unable to save attendance.')}finally{setBusy(null)}}
  async function saveTeacherMark(e:React.FormEvent){
    e.preventDefault()
    if(!selectedTeacherExam||!resultForm.student_id||!resultForm.subject_id||resultForm.score===''){setResultError('Choose the student and assigned subject, then enter a score.');return}
    const score=Number(resultForm.score)
    if(!Number.isFinite(score)||score<0||score>100){setResultError('Scores must be between 0 and 100.');return}
    setResultSaving(true);setResultError('');setResultMessage('')
    try{
      await api('teacher/marks',token,{method:'PUT',body:JSON.stringify({exam_id:selectedTeacherExam.id,student_id:Number(resultForm.student_id),subject_id:Number(resultForm.subject_id),score})})
      const rows=await api<TeacherMark[]>('teacher/marks?exam_id='+selectedTeacherExam.id,token)
      setResultMarks(rows)
      setResultForm({student_id:'',subject_id:'',score:''})
      setResultMessage('Mark saved successfully.')
    }catch(e){setResultError(e instanceof Error?e.message:'Unable to save mark.')}
    finally{setResultSaving(false)}
  }
  if(active==='My Classes') return <section className="panel"><div className="panel-heading"><div><h2>My assigned classes</h2><p>Only classes and subjects assigned to your teacher account appear here.</p></div></div>{message&&<div className="notice">{message}</div>}<div className="class-grid">{assignments.map(a=><div className="class-card" key={a.assignment_id}><BookOpen size={22}/><strong>{a.class}</strong><span>{a.subject}</span></div>)}</div>{!assignments.length&&<div className="empty-state"><GraduationCap size={30}/><p>No classes have been assigned to your account yet.</p></div>}</section>
  if(active==='My Attendance') return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>My attendance record</h2><p>Review the daily attendance status recorded against your staff profile.</p></div></div>
      {ownAttendanceLoading&&<p className="form-hint">Loading your attendance...</p>}
      {ownAttendanceError&&<div className="form-error" role="alert">{ownAttendanceError}</div>}
      {ownAttendance&&<>
        <div className="teacher-attendance-identity"><strong>{ownAttendance.staff_name}</strong><span>{ownAttendance.staff_number}</span></div>
        <p className="attendance-help">Check the date and recorded status. If anything is incorrect, contact the school administrator to request a correction.</p>
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Your status</th><th>Notes</th></tr></thead><tbody>
          {ownAttendance.records.map(record=><tr key={record.id}><td>{new Date(record.attendance_date+'T00:00:00').toLocaleDateString('en-UG',{day:'numeric',month:'short',year:'numeric'})}</td><td><span className={'attendance-status-pill status-'+record.status.toLowerCase()}>{record.status}</span></td><td>{record.notes||'—'}</td></tr>)}
          {!ownAttendance.records.length&&<tr><td colSpan={3}>No attendance records have been saved against your staff profile yet.</td></tr>}
        </tbody></table></div>
      </>}
    </section>
  </div>
    if(active==='My Results') return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>My examination results</h2><p>Enter or correct marks only for your assigned subjects and classes.</p></div></div>
      {resultError&&<div className="form-error" role="alert">{resultError}</div>}
      {resultMessage&&<div className="success-notice" role="status">{resultMessage}</div>}
      <label className="academic-exam-select">Examination
        <select value={examId} onChange={e=>{setExamId(e.target.value);setResultForm({student_id:'',subject_id:'',score:''})}}>
          <option value="">Choose an assigned examination</option>
          {teacherExams.map(exam=><option key={exam.id} value={exam.id}>{exam.name} · {exam.term} {exam.year}</option>)}
        </select>
      </label>
      {!teacherExams.length&&<p className="form-hint">No examinations have been created for your assigned classes yet.</p>}
      {selectedTeacherExam&&<>
        <p className="form-hint">Assigned subjects: {assignedSubjects.map(row=>row.subject).join(', ')||'None'}</p>
        <form className="student-form" onSubmit={saveTeacherMark}>
          <div className="student-form-grid">
            <label>Student *<select required value={resultForm.student_id} onChange={e=>setResultForm({...resultForm,student_id:e.target.value})}><option value="">Select student</option>{resultStudents.map(student=><option key={student.id} value={student.id}>{student.first_name} {student.last_name} · {student.admission_number}</option>)}</select></label>
            <label>Assigned subject *<select required value={resultForm.subject_id} onChange={e=>setResultForm({...resultForm,subject_id:e.target.value})}><option value="">Select subject</option>{assignedSubjects.map(row=><option key={row.subject_id} value={row.subject_id}>{row.subject}</option>)}</select></label>
            <label>Score (0–100) *<input required type="number" min="0" max="100" step="0.01" value={resultForm.score} onChange={e=>setResultForm({...resultForm,score:e.target.value})}/></label>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={resultSaving||!assignedSubjects.length||!resultStudents.length}>{resultSaving?'Saving...':'Save mark'}</button></div>
        </form>
        <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission number</th><th>Subject</th><th>Score</th><th>Verification</th><th>Action</th></tr></thead><tbody>
          {resultMarks.filter(mark=>assignedSubjects.some(row=>row.subject_id===mark.subject_id)).map(mark=><tr key={mark.id}><td>{mark.student_name}</td><td>{mark.admission_number}</td><td>{assignedSubjects.find(row=>row.subject_id===mark.subject_id)?.subject}</td><td>{mark.score.toFixed(2)}</td><td>{mark.verified?'Verified':'Pending administrator review'}</td><td><button type="button" className="secondary-button" disabled={mark.verified} onClick={()=>setResultForm({student_id:String(mark.student_id),subject_id:String(mark.subject_id),score:String(mark.score)})}>{mark.verified?'Locked':'Edit'}</button></td></tr>)}
          {!resultMarks.length&&<tr><td colSpan={6}>No marks have been entered for this examination yet.</td></tr>}
        </tbody></table></div>
      </>}
    </section>
  </div>
  return <section className="panel"><div className="panel-heading"><div><h2>Class attendance</h2><p>Record attendance for students in your assigned classes.</p></div></div>{message&&<div className="notice">{message}</div>}<div className="student-form-grid"><label>Assigned class<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Choose class</option>{assignments.map(a=><option key={a.assignment_id} value={a.class_id}>{a.class} — {a.subject}</option>)}</select></label><label>Attendance date<input type="date" value={attendanceDate} onChange={e=>setAttendanceDate(e.target.value)}/></label></div><div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission number</th><th>Status</th><th>Action</th></tr></thead><tbody>{students.map(student=><tr key={student.id}><td>{student.first_name} {student.last_name}</td><td>{student.admission_number}</td><td><select value={statuses[student.id]||'Present'} onChange={e=>setStatuses(old=>({...old,[student.id]:e.target.value}))}><option>Present</option><option>Absent</option><option>Late</option><option>Excused</option></select></td><td><button className="primary-button" disabled={busy===student.id} onClick={()=>void record(student)}>{busy===student.id?'Saving...':'Save'}</button></td></tr>)}</tbody></table></div>{!students.length&&<div className="empty-state"><Users size={30}/><p>Select one of your assigned classes to load its active students.</p></div>}</section>
}
function SchoolProfileSettings({token,onSaved}:{token:string;onSaved:()=>void}) {
  const [form,setForm]=useState({name:'',address:'',phone:'',email:'',motto:'',school_type:'Secondary',a_level_combinations:'',o_level_optional_subjects:'',a_level_subsidiary_subjects:'',report_logo:''})
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [loaded,setLoaded]=useState(false)

  useEffect(()=>{
    let cancelled=false
    api<any>('settings/school-profile',token).then(p=>{
      if(cancelled)return
      setForm({
        name:p.name||'',address:p.address||'',phone:p.phone||'',email:p.email||'',
        motto:p.motto||'',school_type:p.school_type||'Secondary',
        a_level_combinations:p.a_level_combinations||'',
        o_level_optional_subjects:p.o_level_optional_subjects||'',
        a_level_subsidiary_subjects:p.a_level_subsidiary_subjects||'',report_logo:p.report_logo||''
      })
      setLoaded(true)
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Unable to load school profile.')})
    return ()=>{cancelled=true}
  },[token])

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
        email:email||null,motto:form.motto.trim()||null,report_logo:form.report_logo||null
      })})
      setMessage('School profile saved successfully.')
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
      <div className="form-section">
        <div className="form-section-heading"><span className="form-section-number">01</span><div><h4>School identity</h4><p>These details identify your institution in the school workspace.</p></div></div>
        <div className="student-form-grid">
          <label className="field-span-full">Official school name *<input required maxLength={120} autoComplete="organization" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Enter the registered school name"/></label>
          <label>School type *<select required value={form.school_type} onChange={e=>setForm({...form,school_type:e.target.value})}><option value="Primary">Primary</option><option value="Secondary">Secondary</option></select><small className="field-hint">This controls the class options and academic levels used during student registration. Existing classes will not be changed.</small></label>
          <label>School motto<input maxLength={180} value={form.motto} onChange={e=>setForm({...form,motto:e.target.value})} placeholder="Enter the school motto (optional)"/></label>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-heading"><span className="form-section-number">02</span><div><h4>Contact information</h4><p>Optional details that parents and authorised users can use to contact the school.</p></div></div>
        <div className="student-form-grid">
          <label>Phone number<input type="tel" autoComplete="tel" maxLength={30} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="e.g. 0700 000 000"/></label>
          <label>Email address<input type="email" autoComplete="email" maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="e.g. info@school.ug"/></label>
          <label className="field-span-full">Physical address<input autoComplete="street-address" maxLength={240} value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="Village, town, district or P.O. Box (optional)"/></label>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-heading"><span className="form-section-number">03</span><div><h4>School logo</h4><p>This logo appears beside the school name on printed student reports.</p></div></div>
        <label className="file-upload-button"><span>{form.report_logo ? 'Replace school logo' : 'Choose school logo'}</span><input type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){setError('Choose an image file.');return}if(file.size>1400000){setError('School logo must be 1.4 MB or smaller.');return}const reader=new FileReader();reader.onload=()=>setForm(current=>({...current,report_logo:String(reader.result||'')}));reader.onerror=()=>setError('Unable to read the selected logo.');reader.readAsDataURL(file)}}/></label>
        {form.report_logo && <div className="school-logo-settings-preview"><img src={form.report_logo} alt="School logo preview"/><button type="button" className="secondary-button" onClick={()=>setForm(current=>({...current,report_logo:''}))}>Remove logo</button></div>}
      </div>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={onSaved}>Cancel</button><button className="primary-button" disabled={busy||!loaded}>{busy?'Saving school profile...':'Save school profile'}</button></div>
      <p className="form-hint">Only the school name and school type are compulsory. Optional contact fields can be left blank.</p>
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
  const [selectedId,setSelectedId]=useState('')
  const [roleLabel,setRoleLabel]=useState('')
  const [roleType,setRoleType]=useState<'teacher'|'staff'>('staff')
  const [permissions,setPermissions]=useState<Record<string,string[]>>({})
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  async function load() {
    setLoading(true);setError('')
    try {
      const [u,st,sub,permissionData]=await Promise.all([
        api<any[]>('auth/users',token),api<any>('staff?page=1&page_size=100',token),api<any[]>('subjects',token),api<any>('auth/permissions',token)
      ])
      setUsers(u);setStaff(st.items||[]);setSubjects(sub);setCatalog(permissionData)
      const first=u.find((item:any)=>item.role!=='admin'&&item.role!=='parent')
      if(first&&!selectedId){setSelectedId(String(first.id));setRoleLabel(first.role_label||first.role);setRoleType(first.role==='teacher'?'teacher':'staff');setPermissions(first.permissions||{})}
    } catch(e) {setError(e instanceof Error?e.message:'Unable to load staff accounts.')}
    finally {setLoading(false)}
  }
  useEffect(()=>{void load()},[token])
  function selectAccount(id:string) {
    setSelectedId(id)
    const item=users.find(u=>String(u.id)===id)
    if(item){setRoleLabel(item.role_label||item.role);setRoleType(item.role==='teacher'?'teacher':'staff');setPermissions(item.permissions||{})}
  }
  function applyPreset(label:string) {
    const sections=catalog.presets?.[label]||[]
    const next:Record<string,string[]>={}
    sections.forEach((section:string)=>{next[section]=['view']})
    if(label==='Teacher'||label==='Class Teacher') {
      next['Attendance']=['view','add'];next['My Classes']=['view'];next['My Attendance']=['view'];next['My Results']=['view','add','edit'];next['Announcements']=['view'];next['Timetable']=['view']
    }
    setRoleLabel(label);setRoleType(label==='Teacher'||label==='Class Teacher'?'teacher':'staff');setPermissions(next)
  }
  function toggleSection(section:string,checked:boolean) {
    setPermissions(current=>{
      const next={...current}
      if(checked) next[section]=section==='My Results'?['view','add','edit']:section==='Attendance'&&roleType==='teacher'?['view','add']:['view']
      else delete next[section]
      return next
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
  async function assign(e:React.FormEvent) {
    e.preventDefault()
    if(!assignment.teacher_id||!assignment.class_id||!assignment.subject_id){setError('Select a teacher, class and subject before saving.');return}
    setBusy(true);setError('');setMessage('')
    try {
      await api('teacher-assignments',token,{method:'POST',body:JSON.stringify({teacher_id:Number(assignment.teacher_id),class_id:Number(assignment.class_id),subject_id:Number(assignment.subject_id)})})
      setAssignment({teacher_id:'',class_id:'',subject_id:''});setMessage('Teacher class and subject assignment saved.')
    } catch(e) {setError(e instanceof Error?e.message:'Unable to assign teacher.')}
    finally {setBusy(false)}
  }
  const activeTeachers=users.filter(u=>u.role==='teacher'&&u.active)
  const editableUsers=users.filter(u=>u.role!=='admin'&&u.role!=='parent')
  const presetNames=Object.keys(catalog.presets||{})
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Staff accounts & access</h2><p>Staff login details are created automatically when you register a staff member in the Staff directory.</p></div><button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading||busy}>{loading?'Loading...':'Refresh'}</button></div>
    {error&&<div className="form-error" role="alert">{error}</div>}{message&&<div className="success-notice" role="status">{message}</div>}
    <div className="form-hint">To add an employee and create their login, open the Staff tab and choose Register staff member. SchoolBridge generates the username and temporary passcode automatically.</div>
    <h3>Manage a staff member's access</h3>
    {loading?<p className="form-hint">Loading staff accounts...</p>:!editableUsers.length?<p className="form-hint">No staff login accounts yet. Register a staff member first.</p>:<>
      <div className="student-form-grid">
        <label>Staff member<select value={selectedId} onChange={e=>selectAccount(e.target.value)}><option value="">Choose staff account</option>{editableUsers.map(u=>{const person=staff.find((p:any)=>p.id===u.staff_id);return <option key={u.id} value={u.id}>{person?person.first_name+' '+person.last_name:u.username} — {u.username}</option>})}</select></label>
        <label>Job role<select value={presetNames.includes(roleLabel)?roleLabel:'Custom role'} onChange={e=>{if(e.target.value!=='Custom role')applyPreset(e.target.value)}}><option>Custom role</option>{presetNames.map((name:string)=><option key={name}>{name}</option>)}</select></label>
        <label>Display title<input value={roleLabel} onChange={e=>setRoleLabel(e.target.value)} maxLength={80} placeholder="e.g. Bursar, Secretary, DOS"/></label>
        <label>Staff category<select value={roleType} onChange={e=>setRoleType(e.target.value as 'teacher'|'staff')}><option value="teacher">Teaching staff</option><option value="staff">Non-teaching staff</option></select></label>
      </div>
      <details className="form-disclosure"><summary>Choose which areas this staff member can open</summary>
        <p className="form-hint">Tick only the school areas needed for this person's work. Unticked areas will not appear in their menu.</p>
        <div className="student-form-grid">{(catalog.sections||[]).map((section:string)=><label className="settings-checkbox" key={section}><input type="checkbox" checked={Boolean(permissions[section]?.includes('view'))} onChange={e=>toggleSection(section,e.target.checked)}/>{section}</label>)}</div>
      </details>
      <div className="form-actions"><button type="button" className="primary-button" onClick={()=>void savePermissions()} disabled={busy||!selectedId}>{busy?'Saving...':'Save staff access'}</button></div>
    </>}
    <h3>Assign classes and subjects to teachers</h3>
    <form className="student-form" onSubmit={assign}><div className="student-form-grid">
      <label>Teacher *<select required value={assignment.teacher_id} onChange={e=>setAssignment({...assignment,teacher_id:e.target.value})}><option value="">Select teacher</option>{activeTeachers.map(u=>{const person=staff.find((p:any)=>p.id===u.staff_id);return <option key={u.id} value={u.id}>{person?person.first_name+' '+person.last_name:u.username}</option>})}</select></label>
      <label>Class *<select required value={assignment.class_id} onChange={e=>setAssignment({...assignment,class_id:e.target.value})}><option value="">Select class</option>{classes.map(item=><option key={item.id} value={item.id}>{item.name}{item.section?' — '+item.section:''}</option>)}</select></label>
      <label>Subject *<select required value={assignment.subject_id} onChange={e=>setAssignment({...assignment,subject_id:e.target.value})}><option value="">Select subject</option>{subjects.map(sub=><option key={sub.id} value={sub.id}>{sub.name}</option>)}</select></label>
    </div><div className="form-actions"><button className="primary-button" disabled={busy||loading||!activeTeachers.length||!subjects.length||!classes.length}>{busy?'Saving...':'Save teacher assignment'}</button></div></form>
    <h3>School login accounts</h3>
    <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Username</th><th>Job role</th><th>Areas available</th><th>Status</th></tr></thead><tbody>
      {users.map(u=>{const person=staff.find((p:any)=>p.id===u.staff_id);return <tr key={u.id}><td>{person?person.first_name+' '+person.last_name:(u.role==='admin'?'—':'Unlinked staff login')}</td><td>{u.username}</td><td>{u.role==='admin'?'Administrator':u.role==='parent'?'Parent':u.role_label||u.role}</td><td>{Object.keys(u.permissions||{}).length||(u.role==='admin'?'All':'Limited')}</td><td>{u.active?'Active':'Disabled'}</td></tr>})}
      {!users.length&&<tr><td colSpan={5}>No user accounts found.</td></tr>}
    </tbody></table></div>
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
      const response=await fetch(`${API_BASE_URL}/api/backups/create`,{method:'POST',headers:{Authorization:'Bearer '+token}})
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
      const response=await fetch(`${API_BASE_URL}/api/backups/restore`,{method:'POST',headers:{Authorization:'Bearer '+token},body})
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

function SubjectSettings({token,schoolType}:{token:string;schoolType:'Primary'|'Secondary'}) {
  const catalogue = schoolType === 'Primary' ? PRIMARY_SUBJECT_CATALOGUE : SECONDARY_SUBJECT_CATALOGUE;
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
  useEffect(()=>{void load()},[token])

  const existingNames=new Set(subjects.map(subject=>String(subject.name).trim().toLocaleLowerCase()))
  const available=(name:string)=>!existingNames.has(name.trim().toLocaleLowerCase())
  const visibleGroups=catalogue.map(group=>({
    ...group,
    names:group.names.filter(name=>available(name)&&name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  })).filter(group=>group.names.length)

  function toggleSubject(name:string,checked:boolean) {
    setSelected(current=>checked?[...current,name]:current.filter(item=>item!==name))
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
          await api('subjects',token,{method:'POST',body:JSON.stringify({name:subjectName,code:null})})
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
    <div className="panel-heading"><div><h2>{schoolType} school subjects</h2><p>Only the {schoolType.toLowerCase()} curriculum is shown here. Primary and secondary subject lists are kept separate.</p></div><button type="button" className="secondary-button" onClick={()=>void load()} disabled={loading||busy}>{loading?'Loading...':'Refresh subjects'}</button></div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {message&&<div className="success-notice" role="status">{message}</div>}
    <details className="form-disclosure" open><summary>Add school subjects</summary>
      <form className="student-form" onSubmit={addSelected}>
        <label>Find a subject<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search the subject list"/></label>
        <p className="form-hint">Tick every subject you want. Subjects already registered are hidden from this list.</p>
        {loading?<p className="form-hint">Loading available subjects...</p>:<div className="subject-catalogue">
          {visibleGroups.map(group=><fieldset className="subject-catalogue-group" key={group.group}>
            <legend>{group.group}</legend>
            <div className="subject-catalogue-options">
              {group.names.map(name=><label className="subject-choice" key={name}><input type="checkbox" checked={selected.includes(name)} onChange={e=>toggleSubject(name,e.target.checked)}/><span>{name}</span></label>)}
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
    <div className="panel-heading"><div><h3>Registered subjects</h3><p>{subjects.length} subject{subjects.length===1?'':'s'} currently available</p></div></div>
    {loading?<p className="form-hint">Loading subjects...</p>:<div className="table-wrap"><table><thead><tr><th>Subject</th><th>Code</th></tr></thead><tbody>
      {subjects.map(subject=><tr key={subject.id}><td>{subject.name}</td><td>{subject.code||'—'}</td></tr>)}
      {!subjects.length&&<tr><td colSpan={2}>No subjects have been added yet.</td></tr>}
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
      api<{items:LeadershipStudent[]}>('students/search?page=1&page_size=100&search='+encodeURIComponent(studentSearch),token),
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
