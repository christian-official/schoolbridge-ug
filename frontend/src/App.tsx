import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  ClipboardCheck, FileText, Settings, LogOut,
  Search, Bell, Plus, Menu, X, ArrowUpRight, UserPlus,
  CalendarDays, TrendingUp, ShieldCheck, LoaderCircle,
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
  { label: 'Classes', icon: BookOpen },
  { label: 'Fees & Finance', icon: FileText },
  { label: 'Attendance', icon: ClipboardCheck },
  { label: 'Examinations', icon: FileText },
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
  const [students, setStudents] = useState<RecordItem[]>([])
  const [studentTotal, setStudentTotal] = useState(0)
  const [studentPage, setStudentPage] = useState(1)
  const [studentClassFilter, setStudentClassFilter] = useState('')
  const [classes, setClasses] = useState<RecordItem[]>([])
  const [subjects, setSubjects] = useState<RecordItem[]>([])
  const [dataError, setDataError] = useState('')
  const [search, setSearch] = useState('')
  const [showStudentForm, setShowStudentForm] = useState(false)
  const [showClassForm, setShowClassForm] = useState(false)
  const [classForm, setClassForm] = useState({ name: '', section: '' })
  const [classError, setClassError] = useState('')
  const [classSuccess, setClassSuccess] = useState('')
  const [savingClass, setSavingClass] = useState(false)
  const [savingStudent, setSavingStudent] = useState(false)
  const [studentError, setStudentError] = useState('')
  const [studentSuccess, setStudentSuccess] = useState('')
  const [studentForm, setStudentForm] = useState({
    first_name: '', middle_name: '', last_name: '', gender: '', date_of_birth: '', class_id: '',
    religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', previous_school: '',
    admission_date: new Date().toISOString().slice(0, 10), term1_fee: '0', term2_fee: '0', term3_fee: '0',
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
      const [studentData, classData, subjectData, admissionData] = await Promise.all([
        api<StudentPage>('students/search?page=1&page_size=25', authToken),
        api<RecordItem[]>('classes', authToken),
        api<RecordItem[]>('subjects', authToken),
        api<AdmissionSettings>('settings/admission-number', authToken),
      ])
      setStudents(studentData.items)
      setStudentTotal(studentData.total)
      setStudentPage(1)
      setClasses(classData)
      setSubjects(subjectData)
      setAdmissionSettings(admissionData)
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
          term1_fee: Number(studentForm.term1_fee || 0),
          term2_fee: Number(studentForm.term2_fee || 0),
          term3_fee: Number(studentForm.term3_fee || 0),
          gender: studentForm.gender || null,
          date_of_birth: studentForm.date_of_birth || null,
          class_id: Number(studentForm.class_id),
        }),
      })
      setStudentForm({ first_name: '', middle_name: '', last_name: '', gender: '', date_of_birth: '', class_id: '', religion: '', nationality: '', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', previous_school: '', admission_date: new Date().toISOString().slice(0, 10), term1_fee: '0', term2_fee: '0', term3_fee: '0' })
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

  async function loadStudentPage(page = 1, query = search) {
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '25', search: query })
      if (studentClassFilter) params.set('class_id', studentClassFilter)
      const result = await api<StudentPage>('students/search?' + params.toString(), token)
      setStudents(result.items); setStudentTotal(result.total); setStudentPage(result.page)
    } catch (error) { setDataError(error instanceof Error ? error.message : 'Unable to load student records.') }
  }

  useEffect(() => { if (token && active === 'Students') void loadStudentPage(1, search) }, [search, studentClassFilter, active, token])

  async function loadUser(authToken: string) {
    try {
      const profile = await api<User>('auth/me', authToken)
      setUser(profile)
      await loadSchoolData(authToken)
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
    setSubjects([])
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
          {menu.map(item => {
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
          <button className="nav-item" onClick={() => setActive('Settings')}><Settings size={19} /> Settings</button>
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

          {active === 'Overview' && (
            <>
              <section className="stats-grid">
                <StatCard title="Total students" value={students.length} icon={<GraduationCap />} note="Registered students" />
                <StatCard title="Classes" value={classes.length} icon={<BookOpen />} note="School classes" />
                <StatCard title="Subjects" value={subjects.length} icon={<FileText />} note="Available subjects" />
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
                  <button className="quick-action" onClick={() => setActive('Classes')}><span className="quick-icon purple"><BookOpen /></span><span><strong>Manage classes</strong><small>View school classes</small></span><ArrowUpRight size={17} /></button>
                  <button className="quick-action" onClick={() => setActive('Attendance')}><span className="quick-icon green"><ClipboardCheck /></span><span><strong>Attendance</strong><small>Open attendance records</small></span><ArrowUpRight size={17} /></button>
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
                    <div className="generated-admission"><strong>Admission number</strong><span>Generated automatically when you save</span></div>
                    <label>First name *<input value={studentForm.first_name} onChange={e => setStudentForm({ ...studentForm, first_name: e.target.value })} placeholder="First name" required /></label>
                    <label>Middle name<input value={studentForm.middle_name} onChange={e => setStudentForm({ ...studentForm, middle_name: e.target.value })} /></label>
                    <label>Last name *<input value={studentForm.last_name} onChange={e => setStudentForm({ ...studentForm, last_name: e.target.value })} placeholder="Last name" required /></label>
                    <label>Class *<select value={studentForm.class_id} onChange={e => setStudentForm({ ...studentForm, class_id: e.target.value })} required><option value="">Select class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` — ${item.section}` : ''}</option>)}</select></label>
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
                    <label>Term 1 fees (UGX)<input type="number" min="0" value={studentForm.term1_fee} onChange={e => setStudentForm({ ...studentForm, term1_fee: e.target.value })} /></label>
                    <label>Term 2 fees (UGX)<input type="number" min="0" value={studentForm.term2_fee} onChange={e => setStudentForm({ ...studentForm, term2_fee: e.target.value })} /></label>
                    <label>Term 3 fees (UGX)<input type="number" min="0" value={studentForm.term3_fee} onChange={e => setStudentForm({ ...studentForm, term3_fee: e.target.value })} /></label>
                  </div>
                  {classes.length === 0 && <p className="form-hint">Add a school class first before registering students.</p>}
                  <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowStudentForm(false)}>Cancel</button><button className="primary-button" disabled={savingStudent || classes.length === 0}>{savingStudent ? <><LoaderCircle className="spin" size={16} /> Saving...</> : 'Save student'}</button></div>
                </form>
              )}
              <div className="table-tools student-tools"><div className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or admission number..." /></div><select className="filter-select" value={studentClassFilter} onChange={e => setStudentClassFilter(e.target.value)}><option value="">All classes</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` — ${item.section}` : ""}</option>)}</select></div>
              <StudentTable students={filteredStudents} classes={classes} />
              <div className="pagination-row"><span>Showing {students.length ? (studentPage - 1) * 25 + 1 : 0}–{Math.min(studentPage * 25, studentTotal)} of {studentTotal}</span><div><button className="secondary-button" disabled={studentPage <= 1} onClick={() => void loadStudentPage(studentPage - 1)}>Previous</button><button className="secondary-button" disabled={studentPage * 25 >= studentTotal} onClick={() => void loadStudentPage(studentPage + 1)}>Next</button></div></div>
            </section>
          )}

          {active === 'Classes' && (
            <section className="panel">
              <div className="panel-heading"><div><h2>School classes</h2><p>Classes registered in the system</p></div><button className="primary-button add-student-button" onClick={() => { setShowClassForm(v => !v); setClassError(''); setClassSuccess('') }}><Plus size={16} /> {showClassForm ? 'Close form' : 'Add class'}</button></div>
              {classSuccess && <div className="success-notice">{classSuccess}</div>}
              {classError && <div className="form-error">{classError}</div>}
              {showClassForm && <form className="student-form class-form" onSubmit={registerClass}><div className="form-heading"><div><h3>Create a school class</h3><p>Examples: Primary 1, Senior 1, Senior 2.</p></div></div><div className="student-form-grid class-form-grid"><label>Class name *<input value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} placeholder="e.g. Primary 1" required /></label><label>Section (optional)<input value={classForm.section} onChange={e => setClassForm({ ...classForm, section: e.target.value })} placeholder="e.g. East or A" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowClassForm(false)}>Cancel</button><button className="primary-button" disabled={savingClass}>{savingClass ? 'Saving...' : 'Save class'}</button></div></form>}
              <div className="class-grid">{classes.map(item => <div className="class-card" key={item.id}><BookOpen size={22} /><strong>{item.name}</strong><span>{item.section || 'General section'}</span></div>)}</div>
              {classes.length === 0 && <EmptyState text="No classes have been added yet." />}
            </section>
          )}

          <StaffFinance token={token} active={active} />
          {active === 'Attendance' && <ComingSoon title="Attendance management" description="Daily attendance records and summaries will appear here." />}
          {active === 'Examinations' && <ComingSoon title="Examinations and results" description="Exam setup, marks entry and student results will be managed here." />}
          {active === 'Settings' && (
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

          <footer className="footer"><span>SchoolBridge</span> · School management made simpler <span className="footer-version">Version 0.1 · Local workspace</span></footer>
        </div>
      </main>
    </div>
  )
}

function StatCard({ title, value, icon, note }: { title: string; value: string | number; icon: React.ReactNode; note: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><small><TrendingUp size={14} /> {note}</small></div>
}

function StudentTable({ students, classes = [] }: { students: RecordItem[]; classes?: RecordItem[] }) {
  if (!students.length) return <EmptyState text="No student records to display yet." />
  return (
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Gender</th><th>Class</th></tr></thead><tbody>
      {students.map(student => <tr key={student.id}><td><div className="student-cell"><div className="student-avatar">{(student.first_name || '?').slice(0, 1).toUpperCase()}</div><strong>{student.first_name} {student.last_name}</strong></div></td><td>{student.admission_number}</td><td>{student.gender || '—'}</td><td>{classes.find(item => item.id === student.class_id)?.name || '—'}</td></tr>)}
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
