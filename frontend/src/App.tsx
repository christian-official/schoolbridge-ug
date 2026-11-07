import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  FileText, Settings, LogOut,
  Search, Bell, Plus, Menu, X, ArrowUpRight, UserPlus,
  CalendarDays, TrendingUp, ShieldCheck, LoaderCircle, Wallet,
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
type FinanceSummary = { fees_expected: number; fees_collected: number; outstanding: number; salary_expenses?:number; other_expenses?:number; total_expenses?:number; net_cash_position?:number }

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
]
const teacherMenu = [
  { label: 'My Classes', icon: BookOpen },
  { label: 'Attendance', icon: CalendarDays },
]

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
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

function App() {
  const [token, setToken] = useState(sessionStorage.getItem('sb_token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState('Overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const [settingsSection, setSettingsSection] = useState('home')
  const [students, setStudents] = useState<RecordItem[]>([])
  const [studentTotal, setStudentTotal] = useState(0)
  const [staffTotal, setStaffTotal] = useState(0)
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary>({ fees_expected: 0, fees_collected: 0, outstanding: 0 })
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
    first_name: '', middle_name: '', last_name: '', gender: '', date_of_birth: '', class_id: '',
    religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', previous_school: '',
    admission_date: new Date().toISOString().slice(0, 10), fee_amount: '',
  })
  const [mobileMenu, setMobileMenu] = useState(false)
  const [admissionSettings, setAdmissionSettings] = useState<AdmissionSettings>({
    admission_prefix: 'SB', include_year: true, admission_separator: '-',
    admission_padding: 4, next_admission_number: 1,
  })
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  async function loadSchoolData(authToken: string) {
    setDataError('')
    try {
      const [studentData, classData, admissionData, financeData, staffData] = await Promise.all([
        api<StudentPage>('students/search?page=1&page_size=25', authToken),
        api<RecordItem[]>('classes', authToken),
        api<AdmissionSettings>('settings/admission-number', authToken),
        api<FinanceSummary>('finance/summary', authToken),
        api<{total:number}>('staff?search=&page=1&page_size=1', authToken),
      ])
      setStudents(studentData.items)
      setStudentTotal(studentData.total)
      setStudentPage(1)
      setClasses(classData)
      setAdmissionSettings(admissionData)
      setFinanceSummary(financeData)
      setStaffTotal(staffData.total)
    } catch {
      setDataError('Some school records could not be loaded. Check your connection and permissions.')
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
          section: classForm.section.trim() || null,
        }),
      })
      setClassForm({ name: '', section: '' })
      setShowClassForm(false)
      setClassSuccess('Class created successfully.')
      await loadSchoolData(token)
    } catch (error) {
      setClassError(error instanceof Error ? error.message : 'Unable to create class.')
    } finally {
      setSavingClass(false)
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
          first_name: studentForm.first_name.trim(),
          middle_name: studentForm.middle_name.trim() || null,
          last_name: studentForm.last_name.trim(),
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
        }),
      })
      setStudentForm({ first_name: '', middle_name: '', last_name: '', gender: '', date_of_birth: '', class_id: '', religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', previous_school: '', admission_date: new Date().toISOString().slice(0, 10), fee_amount: '' })
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
    } catch {
      sessionStorage.removeItem('sb_token')
      setToken('')
      setUser(null)
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
      const response = await fetch('/api/auth/login', {
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
    <div className="app-shell">
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
            <button className="secondary-button refresh-button" type="button" onClick={() => { void loadSchoolData(token); if (active === 'Students') void loadStudentPage(1, search); setRefreshKey(value => value + 1) }}>Refresh</button>
            <span className="online-status"><i /> System online</span>
            <button className="icon-button" title="Notifications"><Bell size={19} /></button>
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
                <StatCard title="Total students" value={studentTotal} icon={<GraduationCap />} note="Registered students" />
                <StatCard title="Total staff" value={staffTotal} icon={<Users />} note="Teaching and non-teaching" />
                <StatCard title="Classes" value={classes.length} icon={<BookOpen />} note="School classes" />
                <StatCard title="Fees expected" value={`UGX ${financeSummary.fees_expected.toLocaleString()}`} icon={<FileText />} note="Recorded term charges" />
                <StatCard title="Fees collected" value={`UGX ${financeSummary.fees_collected.toLocaleString()}`} icon={<TrendingUp />} note="Payments received" />
                <StatCard title="Outstanding fees" value={`UGX ${financeSummary.outstanding.toLocaleString()}`} icon={<Bell />} note="Remaining balances" />
                <StatCard title="Salary expenses" value={`UGX ${(financeSummary.salary_expenses||0).toLocaleString()}`} icon={<Users />} note="Recorded salary payments" />
                <StatCard title="Other expenses" value={`UGX ${(financeSummary.other_expenses||0).toLocaleString()}`} icon={<FileText />} note="Recorded school expenses" />
                <StatCard title="Total expenses" value={`UGX ${(financeSummary.total_expenses||0).toLocaleString()}`} icon={<TrendingUp />} note="Salary and other expenses" />
                <StatCard title="Net cash position" value={`UGX ${(financeSummary.net_cash_position||0).toLocaleString()}`} icon={<Wallet />} note="Fees collected less expenses" />
                <StatCard title="Account status" value="Active" icon={<ShieldCheck />} note="Administrator access" />
              </section>
              <section className="dashboard-grid">
                <div className="panel recent-panel">
                  <div className="panel-heading"><div><h2>School records</h2><p>Keep large registers inside their own modules</p></div></div>
                  <button className="quick-action" onClick={() => setActive('Students')}><span className="quick-icon blue"><GraduationCap /></span><span><strong>Student register</strong><small>{studentTotal.toLocaleString()} student records · searchable</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Staff')}><span className="quick-icon purple"><Users /></span><span><strong>Staff directory</strong><small>Teaching and non-teaching staff</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Fees & Finance')}><span className="quick-icon green"><FileText /></span><span><strong>Fees and finance</strong><small>Charges, payments and balances</small></span><ArrowUpRight size={17} /></button>
                </div>
                <div className="panel quick-panel">
                  <div className="panel-heading"><div><h2>Quick actions</h2><p>Common school operations</p></div></div>
                  <button className="quick-action" onClick={() => setActive('Students')}><span className="quick-icon blue"><Plus /></span><span><strong>Manage students</strong><small>View student records</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => { setActive('Settings'); setSettingsSection('classes') }}><span className="quick-icon purple"><BookOpen /></span><span><strong>Manage classes</strong><small>Classes and streams in Settings</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Examinations')}><span className="quick-icon orange"><FileText /></span><span><strong>Examinations</strong><small>View exams and marks</small></span><ArrowUpRight size={17} /></button>
                </div>
              </section>
            </>
          )}

          {active === 'Students' && (
            <section className="panel">
              <div className="panel-heading"><div><h2>Student records</h2><p>{studentTotal.toLocaleString()} registered students · 25 records per page</p></div><button className="primary-button add-student-button" onClick={() => { setShowStudentForm(v => !v); setStudentError(''); setStudentSuccess('') }}><UserPlus size={16} /> {showStudentForm ? 'Close form' : 'Register student'}</button></div>
              {studentSuccess && <div className="success-notice">{studentSuccess}</div>}
              {studentError && <div className="form-error">{studentError}</div>}
              {showStudentForm && (
                <form className="student-form" onSubmit={registerStudent}>
                  <div className="form-heading"><div><h3>New student registration</h3><p>Enter the student's details below.</p></div><span className="required-note">* Required fields</span></div>
                  <div className="student-form-grid">
                    <div className="generated-admission"><strong>Admission number</strong></div>
                    <label>First name *<input value={studentForm.first_name} onChange={e => setStudentForm({ ...studentForm, first_name: e.target.value })} placeholder="First name" required /></label>
                    <label>Middle name<input value={studentForm.middle_name} onChange={e => setStudentForm({ ...studentForm, middle_name: e.target.value })} /></label>
                    <label>Last name *<input value={studentForm.last_name} onChange={e => setStudentForm({ ...studentForm, last_name: e.target.value })} placeholder="Last name" required /></label>
                    <label>Class *<select value={studentForm.class_id} onChange={e => setStudentForm({ ...studentForm, class_id: e.target.value })} required><option value="">Select class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` — ${item.section}` : ''}</option>)}</select></label>
                    <label>Term fee (UGX)<input type="number" min="0" value={studentForm.fee_amount} onChange={e => setStudentForm({ ...studentForm, fee_amount: e.target.value })} placeholder="Enter fee amount" /></label>
                    <label>Gender<select value={studentForm.gender} onChange={e => setStudentForm({ ...studentForm, gender: e.target.value })}><option value="">Select gender</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></label>
                    <label>Date of birth<input type="date" value={studentForm.date_of_birth} onChange={e => setStudentForm({ ...studentForm, date_of_birth: e.target.value })} /></label>
                    <label>Religion<input value={studentForm.religion} onChange={e => setStudentForm({ ...studentForm, religion: e.target.value })} /></label>
                    <label>Nationality<input value={studentForm.nationality} onChange={e => setStudentForm({ ...studentForm, nationality: e.target.value })} /></label>
                    <label>Student phone<input value={studentForm.phone} onChange={e => setStudentForm({ ...studentForm, phone: e.target.value })} /></label>
                    <label>Home address<input value={studentForm.address} onChange={e => setStudentForm({ ...studentForm, address: e.target.value })} /></label>
                    <label>Parent / guardian name<input value={studentForm.guardian_name} onChange={e => setStudentForm({ ...studentForm, guardian_name: e.target.value })} /></label>
                    <label>Guardian relationship<select value={studentForm.guardian_relationship} onChange={e => setStudentForm({ ...studentForm, guardian_relationship: e.target.value })}><option value="">Select relationship</option><option>Parent</option><option>Guardian</option><option>Other relative</option></select></label>
                    <label>Guardian phone<input value={studentForm.guardian_phone} onChange={e => setStudentForm({ ...studentForm, guardian_phone: e.target.value })} /></label>
                    <label>Previous school<input value={studentForm.previous_school} onChange={e => setStudentForm({ ...studentForm, previous_school: e.target.value })} /></label>
                    <label>Admission date<input type="date" value={studentForm.admission_date} onChange={e => setStudentForm({ ...studentForm, admission_date: e.target.value })} /></label>

                  </div>
                  {classes.length === 0 && <p className="form-hint">Add a school class first before registering students.</p>}
                  <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowStudentForm(false)}>Cancel</button><button className="primary-button" disabled={savingStudent || classes.length === 0}>{savingStudent ? <><LoaderCircle className="spin" size={16} /> Saving...</> : 'Save student'}</button></div>
                </form>
              )}
              <div className="table-tools student-tools"><div className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or admission number..." /></div><select className="filter-select" value={studentClassFilter} onChange={e => setStudentClassFilter(e.target.value)}><option value="">All classes</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` — ${item.section}` : ""}</option>)}</select></div>
              <StudentTable students={filteredStudents} classes={classes} onSelect={id => void openStudentProfile(id)} />
              <div className="pagination-row"><span>Showing {students.length ? (studentPage - 1) * 25 + 1 : 0}–{Math.min(studentPage * 25, studentTotal)} of {studentTotal}</span><div><button className="secondary-button" disabled={studentPage <= 1} onClick={() => void loadStudentPage(studentPage - 1)}>Previous</button><button className="secondary-button" disabled={studentPage * 25 >= studentTotal} onClick={() => void loadStudentPage(studentPage + 1)}>Next</button></div></div>
            </section>
          )}



          <StaffFinance token={token} active={active} classes={classes} refreshKey={refreshKey} />
          {studentProfile && (
            <div className="modal-backdrop" onClick={()=>setStudentProfile(null)}>
              <section className="panel student-profile-modal" onClick={e=>e.stopPropagation()}>
                <div className="panel-heading"><div><h2>Student profile</h2><p>{studentProfile.student.admission_number} · {studentProfile.student.status}</p></div><div className="profile-actions"><button className="secondary-button" type="button" onClick={()=>void dismissStudent(studentProfile.student.id)} disabled={studentProfile.student.status==='dismissed'}>Dismiss student</button><button className="secondary-button" type="button" onClick={()=>setStudentProfile(null)}>Close</button></div></div>
                {profileMessage&&<div className="success-notice">{profileMessage}</div>}
                <form className="student-form" onSubmit={saveStudentProfile}>
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
                </form>
                <div className="panel-heading"><div><h3>Fee history</h3><p>All historic charges and payments for this student</p></div></div>
                <div className="stats-grid finance-stats"><div className="stat-card"><span>Total charged</span><strong className="stat-value">UGX {Number(studentProfile.total_charged||0).toLocaleString()}</strong></div><div className="stat-card"><span>Total paid</span><strong className="stat-value">UGX {Number(studentProfile.total_paid||0).toLocaleString()}</strong></div><div className="stat-card"><span>Balance</span><strong className="stat-value">UGX {Number(studentProfile.total_balance||0).toLocaleString()}</strong></div></div>
                <div className="table-wrap"><table><thead><tr><th>Term</th><th>Year</th><th>Charged</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{studentProfile.fees.map((fee:any)=><tr key={fee.charge_id}><td>{fee.term}</td><td>{fee.year}</td><td>{Number(fee.amount).toLocaleString()}</td><td>{Number(fee.paid).toLocaleString()}</td><td>{Number(fee.balance).toLocaleString()}</td></tr>)}</tbody></table></div>
                <div className="panel-heading"><div><h3>Payment history</h3><p>Individual payments and receipt references</p></div></div>
                <div className="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Term</th><th>Method</th><th>Amount (UGX)</th></tr></thead><tbody>{studentProfile.fees.flatMap((fee:any)=>fee.payments.map((payment:any)=><tr key={payment.id}><td>{payment.date}</td><td>{payment.receipt_number||payment.reference||'—'}</td><td>{fee.term} {fee.year}</td><td>{payment.method}</td><td>{Number(payment.amount).toLocaleString()}</td></tr>))}</tbody></table></div>
              </section>
            </div>
          )}
          {active === 'Examinations' && <ComingSoon title="Examinations and results" description="Exam setup, marks entry and student results will be managed here." />}
          {active === 'Settings' && settingsSection === 'home' && (
            <section className="settings-hub">
              <div className="panel-heading"><div><h2>School settings</h2><p>Choose a category to configure how SchoolBridge works for this school.</p></div></div>
              <div className="settings-category-grid">
                <button className="settings-category" onClick={() => setSettingsSection('school')}><span className="settings-category-icon"><GraduationCap /></span><strong>School Profile</strong><small>School name, contacts and identity</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('classes')}><span className="settings-category-icon"><BookOpen /></span><strong>Classes & Streams</strong><small>Create classes, streams and manage class fees</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('admission')}><span className="settings-category-icon"><Users /></span><strong>Admission Numbers</strong><small>Set the format for student admission numbers</small><ArrowUpRight /></button>
                <button className="settings-category" onClick={() => setSettingsSection('academic')}><span className="settings-category-icon"><CalendarDays /></span><strong>Academic Year & Terms</strong><small>Set the active academic year and term</small><ArrowUpRight /></button>
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
              <form className="student-form" onSubmit={saveAdmissionSettings}>
                <div className="student-form-grid">
                  <label>School prefix<input maxLength={20} value={admissionSettings.admission_prefix} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_prefix: e.target.value })} placeholder="e.g. KIS" /></label>
                  <label>Separator<select value={admissionSettings.admission_separator} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_separator: e.target.value })}><option value="-">Hyphen (-)</option><option value="/">Slash (/)</option><option value="">None</option></select></label>
                  <label>Number of digits<select value={admissionSettings.admission_padding} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_padding: Number(e.target.value) })}>{[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} digits</option>)}</select></label>
                  <label>Next sequence number<input type="number" min="1" value={admissionSettings.next_admission_number} onChange={e => setAdmissionSettings({ ...admissionSettings, next_admission_number: Math.max(1, Number(e.target.value)) })} required /></label>
                  <label className="settings-checkbox"><input type="checkbox" checked={admissionSettings.include_year} onChange={e => setAdmissionSettings({ ...admissionSettings, include_year: e.target.checked })} /> Include current year</label>
                </div>
                <div className="number-preview"><span>Example of next admission number</span><strong>{[admissionSettings.admission_prefix.trim(), ...(admissionSettings.include_year ? [String(new Date().getFullYear())] : []), String(admissionSettings.next_admission_number).padStart(admissionSettings.admission_padding, '0')].filter(Boolean).join(admissionSettings.admission_separator)}</strong></div>
                <p className="form-hint">These settings affect new registrations only. Existing admission numbers will not be changed.</p>
                <div className="form-actions"><button className="primary-button" disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save numbering settings'}</button></div>
              </form>
            </section>
              )}
              {settingsSection === 'school' && <SchoolProfileSettings token={token} />}
              {settingsSection === 'academic' && <><AcademicSettings token={token} /><SubjectSettings token={token} /></>}
              {settingsSection === 'users' && <TeacherUsersSettings token={token} classes={classes} />}
              {settingsSection === 'backups' && <BackupSettings token={token} />}
              {settingsSection === 'audit' && <AuditLogSettings token={token} />}
            </div>
          )}
          {active === 'Settings' && settingsSection === 'classes' && (
            <section className="panel">
              <div className="panel-heading"><div><h2>School classes</h2><p>Classes registered in the system</p></div><button className="primary-button add-student-button" onClick={() => { setShowClassForm(v => !v); setClassError(''); setClassSuccess('') }}><Plus size={16} /> {showClassForm ? 'Close form' : 'Add class'}</button></div>
              {classSuccess && <div className="success-notice">{classSuccess}</div>}
              {classError && <div className="form-error">{classError}</div>}
              {showClassForm && <form className="student-form class-form" onSubmit={registerClass}><div className="form-heading"><div><h3>Create a school class</h3><p>Examples: Primary 1, Senior 1, Senior 2.</p></div></div><div className="student-form-grid class-form-grid"><label>Class name *<input value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} placeholder="e.g. Primary 1" required /></label><label>Section (optional)<input value={classForm.section} onChange={e => setClassForm({ ...classForm, section: e.target.value })} placeholder="e.g. East or A" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowClassForm(false)}>Cancel</button><button className="primary-button" disabled={savingClass}>{savingClass ? 'Saving...' : 'Save class'}</button></div></form>}
              <div className="class-grid">{classes.map(item => <div className="class-card" key={item.id}><BookOpen size={22} /><strong>{item.name}</strong><span>{item.section || 'General section'}</span></div>)}</div>
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


function FeeStructure({token, classes}:{token:string;classes:RecordItem[]}) {
  const [classId,setClassId]=useState('')
  const [year,setYear]=useState(new Date().getFullYear())
  const [fees,setFees]=useState([0,0,0])
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function load(id=classId, selectedYear=year) {
    if(!id) return
    try { const response=await api<{fees:{term:string;amount:number}[]}>('classes/'+id+'/fees?year='+selectedYear,token); setFees([response.fees.find(x=>x.term==='Term 1')?.amount||0,response.fees.find(x=>x.term==='Term 2')?.amount||0,response.fees.find(x=>x.term==='Term 3')?.amount||0]); setMessage('') }
    catch(e) {setMessage(e instanceof Error?e.message:'Could not load class fees.')}
  }
  useEffect(()=>{void load()},[classId,year])
  async function save(e:React.FormEvent) {
    e.preventDefault(); if(!classId)return; setBusy(true);setMessage('')
    try { for(let i=0;i<3;i++) await api('classes/'+classId+'/fees',token,{method:'PUT',body:JSON.stringify({term:'Term '+(i+1),year,amount:fees[i]})}); setMessage('Class fee structure saved. Existing student charges remain unchanged.') }
    catch(e) {setMessage(e instanceof Error?e.message:'Unable to save fees.')}
    finally {setBusy(false)}
  }
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Class fee structure</h2><p>Set one standard fee per class for each term. New registrations use the active term amount.</p></div></div>{message&&<div className="success-notice">{message}</div>}<form className="student-form" onSubmit={save}><div className="student-form-grid"><label>Class<select required value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Choose class</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}{c.section?' — '+c.section:''}</option>)}</select></label><label>Academic year<input type="number" min="2000" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))}/></label>{[0,1,2].map(i=><label key={i}>Term {i+1} fee (UGX)<input type="number" min="0" value={fees[i]} onChange={e=>setFees(old=>old.map((v,index)=>index===i?Number(e.target.value):v))}/></label>)}</div><p className="form-hint">Changing a class fee will not rewrite charges already issued to students.</p><div className="form-actions"><button className="primary-button" disabled={!classId||busy}>{busy?'Saving...':'Save class fees'}</button></div></form></section>
}

function AcademicSettings({token}:{token:string}) {
  const [year,setYear]=useState(new Date().getFullYear())
  const [term,setTerm]=useState('Term 1')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api<{academic_year:number;active_term:string}>('settings/academic',token).then(x=>{setYear(x.academic_year);setTerm(x.active_term)}).catch(e=>setMessage(e.message))},[token])
  async function save(e:React.FormEvent) {e.preventDefault();setBusy(true);setMessage('');try{await api('settings/academic',token,{method:'PUT',body:JSON.stringify({academic_year:year,active_term:term})});setMessage('Active academic year and term saved. New registrations will use this term.')}catch(e){setMessage(e instanceof Error?e.message:'Unable to save academic settings.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Academic year and active term</h2><p>These settings determine which class fee is assigned to new students.</p></div></div>{message&&<div className="success-notice">{message}</div>}<form className="student-form" onSubmit={save}><div className="student-form-grid"><label>Academic year<input type="number" min="2000" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))}/></label><label>Active term<select value={term} onChange={e=>setTerm(e.target.value)}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save academic settings'}</button></div></form></section>
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
function SchoolProfileSettings({token}:{token:string}) {
  const [form,setForm]=useState({name:'My School',address:'',phone:'',email:'',motto:''})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api<any>('settings/school-profile',token).then(p=>setForm({name:p.name||'My School',address:p.address||'',phone:p.phone||'',email:p.email||'',motto:p.motto||''})).catch(e=>setMessage(e.message))},[token])
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('settings/school-profile',token,{method:'PUT',body:JSON.stringify({...form,address:form.address||null,phone:form.phone||null,email:form.email||null,motto:form.motto||null})});setMessage('School profile saved.')}catch(e){setMessage(e instanceof Error?e.message:'Unable to save school profile.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>School profile</h2><p>Set the identity and contact information used in school records and receipts.</p></div></div>{message&&<div className="success-notice">{message}</div>}<form className="student-form" onSubmit={save}><div className="student-form-grid"><label>School name *<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Phone number<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Email address<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Address<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label><label>School motto<input value={form.motto} onChange={e=>setForm({...form,motto:e.target.value})}/></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save school profile'}</button></div></form></section>
}

function TeacherUsersSettings({token,classes}:{token:string;classes:RecordItem[]}) {
  const [users,setUsers]=useState<any[]>([])
  const [subjects,setSubjects]=useState<any[]>([])
  const [teacher,setTeacher]=useState({username:'',email:'',password:''})
  const [assignment,setAssignment]=useState({teacher_id:'',class_id:'',subject_id:''})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function load(){try{const [u,sub]=await Promise.all([api<any[]>('auth/users',token),api<any[]>('subjects',token)]);setUsers(u);setSubjects(sub)}catch(e){setMessage(e instanceof Error?e.message:'Unable to load user settings.')}}
  useEffect(()=>{void load()},[token])
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('auth/teachers',token,{method:'POST',body:JSON.stringify(teacher)});setTeacher({username:'',email:'',password:''});setMessage('Teacher account created.');await load()}catch(e){setMessage(e instanceof Error?e.message:'Unable to create account.')}finally{setBusy(false)}}
  async function assign(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('teacher-assignments',token,{method:'POST',body:JSON.stringify({teacher_id:Number(assignment.teacher_id),class_id:Number(assignment.class_id),subject_id:Number(assignment.subject_id)})});setMessage('Teacher assignment saved.');setAssignment({teacher_id:'',class_id:'',subject_id:''})}catch(e){setMessage(e instanceof Error?e.message:'Unable to assign teacher.')}finally{setBusy(false)}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>Users and permissions</h2><p>Create teacher accounts and restrict their workspace to assigned classes and subjects.</p></div></div>{message&&<div className="success-notice">{message}</div>}<h3>Create teacher account</h3><form className="student-form" onSubmit={create}><div className="student-form-grid"><label>Username *<input required value={teacher.username} onChange={e=>setTeacher({...teacher,username:e.target.value})}/></label><label>Email *<input required type="email" value={teacher.email} onChange={e=>setTeacher({...teacher,email:e.target.value})}/></label><label>Temporary password *<input required type="password" minLength={12} value={teacher.password} onChange={e=>setTeacher({...teacher,password:e.target.value})}/></label></div><p className="form-hint">Use a strong password of at least 12 characters and share it securely with the teacher.</p><div className="form-actions"><button className="primary-button" disabled={busy}>Create teacher account</button></div></form><h3>Assign classes and subjects</h3><form className="student-form" onSubmit={assign}><div className="student-form-grid"><label>Teacher<select required value={assignment.teacher_id} onChange={e=>setAssignment({...assignment,teacher_id:e.target.value})}><option value="">Select teacher</option>{users.filter(u=>u.role==='teacher'&&u.active).map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select></label><label>Class and stream<select required value={assignment.class_id} onChange={e=>setAssignment({...assignment,class_id:e.target.value})}><option value="">Select class</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}{c.section?' — '+c.section:''}</option>)}</select></label><label>Subject<select required value={assignment.subject_id} onChange={e=>setAssignment({...assignment,subject_id:e.target.value})}><option value="">Select subject</option>{subjects.map(sub=><option key={sub.id} value={sub.id}>{sub.name}</option>)}</select></label></div><div className="form-actions"><button className="primary-button" disabled={busy||!subjects.length||!classes.length}>Save teacher assignment</button></div></form><h3>School user accounts</h3><div className="table-wrap"><table><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.username}</td><td>{u.email}</td><td>{u.role}</td><td>{u.active?'Active':'Disabled'}</td></tr>)}</tbody></table></div></section>
}

function BackupSettings({token}:{token:string}) {
  const [file,setFile]=useState<File|null>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function createBackup(){
    setBusy(true);setMessage('')
    try {const response=await fetch('/api/backups/create',{method:'POST',headers:{Authorization:'Bearer '+token}});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||'Backup failed')}const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='schoolbridge-backup-'+new Date().toISOString().slice(0,10)+'.sqlite3';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);setMessage('Database backup created and downloaded. Keep a copy somewhere safe.')}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to create backup.')}finally{setBusy(false)}
  }
  async function restoreBackup(){
    if(!file)return
    if(!window.confirm('Restore this backup? Current school data will be replaced. A safety copy of the current database will be kept.'))return
    setBusy(true);setMessage('')
    try {const body=new FormData();body.append('file',file);const response=await fetch('/api/backups/restore',{method:'POST',headers:{Authorization:'Bearer '+token},body});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'Restore failed');setMessage(data.message||'Restore staged. Restart the backend to complete it.');setFile(null)}
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

function SubjectSettings({token}:{token:string}) {
  const [subjects,setSubjects]=useState<any[]>([])
  const [name,setName]=useState('')
  const [code,setCode]=useState('')
  const [message,setMessage]=useState('')
  async function load(){try{setSubjects(await api<any[]>('subjects',token))}catch(e){setMessage(e instanceof Error?e.message:'Unable to load subjects.')}}
  useEffect(()=>{void load()},[token])
  async function add(e:React.FormEvent){e.preventDefault();setMessage('');try{await api('subjects',token,{method:'POST',body:JSON.stringify({name:name.trim(),code:code.trim()||null})});setName('');setCode('');setMessage('Subject added.');await load()}catch(e){setMessage(e instanceof Error?e.message:'Unable to add subject.')}}
  return <section className="panel settings-panel"><div className="panel-heading"><div><h2>School subjects</h2><p>Manage subjects used for examinations and teacher assignments.</p></div></div>{message&&<div className="success-notice">{message}</div>}<form className="student-form" onSubmit={add}><div className="student-form-grid"><label>Subject name *<input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Mathematics"/></label><label>Subject code<input value={code} onChange={e=>setCode(e.target.value)} placeholder="Optional code"/></label></div><div className="form-actions"><button className="primary-button">Add subject</button></div></form><div className="table-wrap"><table><thead><tr><th>Subject</th><th>Code</th></tr></thead><tbody>{subjects.map(subject=><tr key={subject.id}><td>{subject.name}</td><td>{subject.code||'—'}</td></tr>)}</tbody></table></div></section>
}
