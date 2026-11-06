import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen, ClipboardCheck, FileText,
  Settings, LogOut, Search, Bell, Plus, Menu, X, UserPlus, CalendarDays,
  ShieldCheck, LoaderCircle, Wallet, ChevronLeft, ChevronRight,
} from 'lucide-react'
import './App.css'

type User = { id: number; username: string; email: string; role: string; active: boolean }
type Item = { id: number; [key: string]: any }
type PageResult = { items: Item[]; total: number; page: number; page_size: number; pages: number }
type AdmissionSettings = { admission_prefix: string; include_year: boolean; admission_separator: string; admission_padding: number; next_admission_number: number }
type DashboardSummary = { students: number; classes: number; staff: number; fees_expected: number; fees_collected: number; outstanding: number }

const menu = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Students', icon: GraduationCap },
  { label: 'Staff', icon: Users }, { label: 'Classes', icon: BookOpen },
  { label: 'Fees & Finance', icon: Wallet }, { label: 'Attendance', icon: ClipboardCheck },
  { label: 'Examinations', icon: FileText },
]

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
}
const money = (value: number) => new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(value || 0)

function App() {
  const [token, setToken] = useState(sessionStorage.getItem('sb_token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState('Overview')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [classes, setClasses] = useState<Item[]>([])
  const [showClassForm, setShowClassForm] = useState(false)
  const [classForm, setClassForm] = useState({ name: '', section: '' })
  const [classError, setClassError] = useState('')
  const [subjects, setSubjects] = useState<Item[]>([])
  const [summary, setSummary] = useState<DashboardSummary>({ students: 0, classes: 0, staff: 0, fees_expected: 0, fees_collected: 0, outstanding: 0 })
  const [dataError, setDataError] = useState('')
  const [admissionSettings, setAdmissionSettings] = useState<AdmissionSettings>({ admission_prefix: 'SB', include_year: true, admission_separator: '-', admission_padding: 4, next_admission_number: 1 })
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  const [students, setStudents] = useState<PageResult>({ items: [], total: 0, page: 1, page_size: 25, pages: 0 })
  const [studentSearch, setStudentSearch] = useState('')
  const [studentClass, setStudentClass] = useState('')
  const [studentGender, setStudentGender] = useState('')
  const [studentPage, setStudentPage] = useState(1)
  const [showStudentForm, setShowStudentForm] = useState(false)
  const [savingStudent, setSavingStudent] = useState(false)
  const [studentError, setStudentError] = useState('')
  const [studentSuccess, setStudentSuccess] = useState('')
  const [studentForm, setStudentForm] = useState({
    first_name: '', middle_name: '', last_name: '', gender: '', date_of_birth: '',
    religion: '', nationality: 'Ugandan', phone: '', address: '', guardian_name: '',
    guardian_relationship: '', guardian_phone: '', previous_school: '', admission_date: new Date().toISOString().slice(0, 10),
    class_id: '', term1_fee: '', term2_fee: '', term3_fee: '',
  })

  const [staff, setStaff] = useState<PageResult>({ items: [], total: 0, page: 1, page_size: 25, pages: 0 })
  const [staffSearch, setStaffSearch] = useState('')
  const [staffCategory, setStaffCategory] = useState('')
  const [staffPage, setStaffPage] = useState(1)
  const [showStaffForm, setShowStaffForm] = useState(false)
  const [staffError, setStaffError] = useState('')
  const [staffSuccess, setStaffSuccess] = useState('')
  const [staffForm, setStaffForm] = useState({ staff_number: '', first_name: '', last_name: '', category: 'Teaching', job_title: '', department: '', phone: '', email: '' })

  const [financeSearch, setFinanceSearch] = useState('')
  const [financeStudent, setFinanceStudent] = useState<Item | null>(null)
  const [financeLedger, setFinanceLedger] = useState<any>(null)
  const [paymentForm, setPaymentForm] = useState({ academic_year: new Date().getFullYear(), term: 'Term 1', amount: '', payment_method: 'Cash', reference: '' })
  const [financeError, setFinanceError] = useState('')
  const [financeSuccess, setFinanceSuccess] = useState('')

  async function loadSummary(authToken: string) {
    const [classesData, subjectsData, summaryData, settingsData] = await Promise.all([
      api<Item[]>('classes', authToken), api<Item[]>('subjects', authToken),
      api<DashboardSummary>('dashboard/summary', authToken),
      api<AdmissionSettings>('settings/admission-number', authToken),
    ])
    setClasses(classesData); setSubjects(subjectsData); setSummary(summaryData); setAdmissionSettings(settingsData)
  }
  async function loadStudents(authToken: string, page = studentPage, q = studentSearch, classId = studentClass, gender = studentGender) {
    const params = new URLSearchParams({ page: String(page), page_size: '25', q })
    if (classId) params.set('class_id', classId)
    if (gender) params.set('gender', gender)
    setStudents(await api<PageResult>(`students/page?${params}`, authToken))
  }
  async function loadStaff(authToken: string, page = staffPage, q = staffSearch, category = staffCategory) {
    const params = new URLSearchParams({ page: String(page), page_size: '25', q })
    if (category) params.set('category', category)
    setStaff(await api<PageResult>(`staff?${params}`, authToken))
  }
  async function refreshAll(authToken: string) {
    setDataError('')
    try { await Promise.all([loadSummary(authToken), loadStudents(authToken, 1), loadStaff(authToken, 1)]); setStudentPage(1); setStaffPage(1) }
    catch (error) { setDataError(error instanceof Error ? error.message : 'Unable to load school records.') }
  }
  async function loadUser(authToken: string) {
    try { const profile = await api<User>('auth/me', authToken); setUser(profile); await refreshAll(authToken) }
    catch { sessionStorage.removeItem('sb_token'); setToken(''); setUser(null) }
  }
  useEffect(() => { if (token) void loadUser(token) }, [token])
  useEffect(() => { if (token && active === 'Students') void loadStudents(token, studentPage) }, [studentPage])
  useEffect(() => { if (token && active === 'Staff') void loadStaff(token, staffPage) }, [staffPage])

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setLoginError('')
    try {
      const body = new URLSearchParams(); body.set('username', username); body.set('password', password)
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'Login failed')
      sessionStorage.setItem('sb_token', result.access_token); setToken(result.access_token); setPassword('')
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'Unable to sign in') }
    finally { setLoading(false) }
  }
  function logout() { sessionStorage.removeItem('sb_token'); setToken(''); setUser(null) }

  async function registerStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSavingStudent(true); setStudentError(''); setStudentSuccess('')
    try {
      const created = await api<Item>('students', token, { method: 'POST', body: JSON.stringify({
        first_name: studentForm.first_name.trim(), middle_name: studentForm.middle_name.trim() || null,
        last_name: studentForm.last_name.trim(), gender: studentForm.gender || null,
        date_of_birth: studentForm.date_of_birth || null, religion: studentForm.religion || null,
        nationality: studentForm.nationality || null, phone: studentForm.phone || null,
        address: studentForm.address || null, guardian_name: studentForm.guardian_name || null,
        guardian_relationship: studentForm.guardian_relationship || null, guardian_phone: studentForm.guardian_phone || null,
        previous_school: studentForm.previous_school || null, admission_date: studentForm.admission_date || null,
        class_id: Number(studentForm.class_id),
        term1_fee: Number(studentForm.term1_fee || 0), term2_fee: Number(studentForm.term2_fee || 0),
        term3_fee: Number(studentForm.term3_fee || 0),
      }) })
      setStudentSuccess(`Student registered: ${created.admission_number}. Initial term charges have been saved.`)
      setStudentForm({ first_name: '', middle_name: '', last_name: '', gender: '', date_of_birth: '', religion: '', nationality: 'Ugandan', phone: '', address: '', guardian_name: '', guardian_relationship: '', guardian_phone: '', previous_school: '', admission_date: new Date().toISOString().slice(0, 10), class_id: '', term1_fee: '', term2_fee: '', term3_fee: '' })
      setShowStudentForm(false); await loadStudents(token, 1, studentSearch, studentClass, studentGender); setStudentPage(1); await loadSummary(token)
    } catch (error) { setStudentError(error instanceof Error ? error.message : 'Unable to register student. Check the student and fee records.') }
    finally { setSavingStudent(false) }
  }

  async function registerStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStaffError(''); setStaffSuccess('')
    try {
      await api('staff', token, { method: 'POST', body: JSON.stringify(staffForm) })
      setStaffSuccess('Staff member added successfully.'); setStaffForm({ staff_number: '', first_name: '', last_name: '', category: 'Teaching', job_title: '', department: '', phone: '', email: '' })
      setShowStaffForm(false); await loadStaff(token, 1); setStaffPage(1); await loadSummary(token)
    } catch (error) { setStaffError(error instanceof Error ? error.message : 'Unable to add staff member.') }
  }

  async function registerClass(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setClassError('')
    try {
      await api('classes', token, { method: 'POST', body: JSON.stringify({
        name: classForm.name.trim(), section: classForm.section.trim() || null,
      }) })
      setClassForm({ name: '', section: '' }); setShowClassForm(false)
      await loadSummary(token)
    } catch (error) { setClassError(error instanceof Error ? error.message : 'Unable to create class.') }
  }

  async function saveAdmissionSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSavingSettings(true); setSettingsError(''); setSettingsSuccess('')
    try { const saved = await api<AdmissionSettings>('settings/admission-number', token, { method: 'PUT', body: JSON.stringify(admissionSettings) }); setAdmissionSettings(saved); setSettingsSuccess('Admission numbering settings saved.') }
    catch (error) { setSettingsError(error instanceof Error ? error.message : 'Unable to save settings.') }
    finally { setSavingSettings(false) }
  }

  async function findFinanceStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFinanceError(''); setFinanceSuccess(''); setFinanceLedger(null); setFinanceStudent(null)
    try {
      const result = await api<PageResult>(`students/page?page=1&page_size=10&q=${encodeURIComponent(financeSearch)}`, token)
      if (!result.items.length) throw new Error('No student found. Search using the admission number or name.')
      if (result.items.length > 1) throw new Error('More than one student matched. Enter the full admission number for an exact match.')
      setFinanceStudent(result.items[0])
      setFinanceLedger(await api<any>(`finance/student/${result.items[0].id}`, token))
    } catch (error) { setFinanceError(error instanceof Error ? error.message : 'Unable to find student.') }
  }
  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!financeStudent) return
    setFinanceError(''); setFinanceSuccess('')
    try {
      await api('finance/payments', token, { method: 'POST', body: JSON.stringify({
        student_id: financeStudent.id, ...paymentForm, amount: Number(paymentForm.amount),
        reference: paymentForm.reference || null,
      }) })
      setFinanceSuccess('Payment recorded successfully.')
      setFinanceLedger(await api<any>(`finance/student/${financeStudent.id}`, token)); setPaymentForm({ ...paymentForm, amount: '', reference: '' }); await loadSummary(token)
    } catch (error) { setFinanceError(error instanceof Error ? error.message : 'Unable to record payment.') }
  }

  if (!token || !user) return <main className="login-page"><section className="login-card">
    <div className="brand-mark"><GraduationCap size={30} /></div><div className="brand-name">School<span>Bridge</span></div>
    <p className="login-subtitle">Your school's operations, connected.</p><h1>Welcome back</h1><p className="muted">Sign in to your school workspace.</p>
    <form onSubmit={login}><label htmlFor="username">Username</label><input id="username" value={username} onChange={e => setUsername(e.target.value)} required placeholder="Enter your username" />
      <label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter your password" />
      {loginError && <p className="error">{loginError}</p>}<button className="primary-button login-button" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} /> Signing in...</> : 'Sign in'}</button></form>
    <p className="login-foot"><ShieldCheck size={15} /> Secure school access</p></section></main>

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><div className="brand-mark"><GraduationCap size={25} /></div><div className="brand-name">School<span>Bridge</span></div><button className="mobile-close" onClick={() => setMobileMenu(false)}><X /></button></div>
      <div className="school-label">SCHOOL MANAGEMENT</div><nav>{menu.map(item => { const Icon = item.icon; return <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} onClick={() => { setActive(item.label); setMobileMenu(false) }}><Icon size={19} /><span>{item.label}</span>{active === item.label && <span className="active-dot" />}</button> })}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${active === 'Settings' ? 'active' : ''}`} onClick={() => setActive('Settings')}><Settings size={19} /> Settings</button>
        <div className="profile-card"><div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="profile-info"><strong>{user.username}</strong><small>{user.role}</small></div><button className="logout-button" title="Sign out" onClick={logout}><LogOut size={18} /></button></div></div>
    </aside>
    {mobileMenu && <button className="mobile-overlay" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
    <main className="main-area"><header className="topbar"><button className="mobile-menu-button" onClick={() => setMobileMenu(true)}><Menu /></button><div className="breadcrumb">School workspace <span>/</span> <strong>{active}</strong></div><div className="top-actions"><span className="online-status"><i /> System online</span><button className="icon-button" title="Notifications"><Bell size={19} /></button><div className="top-avatar">{user.username.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content"><div className="welcome-row"><div><p className="eyebrow">SCHOOL MANAGEMENT SYSTEM</p><h1>{active === 'Overview' ? 'Dashboard overview' : active}</h1><p className="muted">Welcome back, {user.username}. Here's your school at a glance.</p></div><div className="date-chip"><CalendarDays size={17} /> {new Date().toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
      {dataError && <div className="notice">{dataError} <button onClick={() => void refreshAll(token)}>Retry</button></div>}

      {active === 'Overview' && <><section className="stats-grid">
        <StatCard title="Total students" value={summary.students.toLocaleString()} icon={<GraduationCap />} note="All registered students" />
        <StatCard title="Staff members" value={summary.staff.toLocaleString()} icon={<Users />} note="Teaching and non-teaching" />
        <StatCard title="Fees collected" value={money(summary.fees_collected)} icon={<Wallet />} note="Recorded payments" />
        <StatCard title="Outstanding fees" value={money(summary.outstanding)} icon={<Wallet />} note="Charges less payments" />
      </section><section className="dashboard-grid"><div className="panel"><div className="panel-heading"><div><h2>Financial overview</h2><p>Recorded school fee charges and payments</p></div></div><div className="finance-summary"><div><span>Fees expected</span><strong>{money(summary.fees_expected)}</strong></div><div><span>Fees collected</span><strong>{money(summary.fees_collected)}</strong></div><div><span>Outstanding balance</span><strong>{money(summary.outstanding)}</strong></div></div></div>
        <div className="panel quick-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Common school operations</p></div></div><button className="quick-action" onClick={() => setActive('Students')}><span className="quick-icon blue"><Plus /></span><span><strong>Manage students</strong><small>Search and register students</small></span></button><button className="quick-action" onClick={() => setActive('Staff')}><span className="quick-icon purple"><Users /></span><span><strong>Manage staff</strong><small>Teaching and non-teaching staff</small></span></button><button className="quick-action" onClick={() => setActive('Fees & Finance')}><span className="quick-icon green"><Wallet /></span><span><strong>Record school fees</strong><small>Payments and student balances</small></span></button></div></section></>}

      {active === 'Students' && <section className="panel"><div className="panel-heading"><div><h2>Student register</h2><p>{students.total.toLocaleString()} registered students · Showing {students.items.length} per page</p></div><button className="primary-button add-student-button" onClick={() => { setShowStudentForm(!showStudentForm); setStudentError(''); setStudentSuccess('') }}><UserPlus size={16} /> {showStudentForm ? 'Close form' : 'Register student'}</button></div>
        {studentSuccess && <div className="success-notice">{studentSuccess}</div>}{studentError && <div className="form-error">{studentError}</div>}
        {showStudentForm && <form className="student-form" onSubmit={registerStudent}><div className="form-heading"><div><h3>New student registration</h3><p>Personal, guardian, academic and term-fee information.</p></div><span className="required-note">* Required</span></div>
          <div className="form-section-title">Student information</div><div className="student-form-grid">
            <label>First name *<input required value={studentForm.first_name} onChange={e => setStudentForm({ ...studentForm, first_name: e.target.value })} /></label>
            <label>Middle name<input value={studentForm.middle_name} onChange={e => setStudentForm({ ...studentForm, middle_name: e.target.value })} /></label>
            <label>Last name *<input required value={studentForm.last_name} onChange={e => setStudentForm({ ...studentForm, last_name: e.target.value })} /></label>
            <label>Class *<select required value={studentForm.class_id} onChange={e => setStudentForm({ ...studentForm, class_id: e.target.value })}><option value="">Select class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ''}</option>)}</select></label>
            <label>Gender<select value={studentForm.gender} onChange={e => setStudentForm({ ...studentForm, gender: e.target.value })}><option value="">Select gender</option><option>Male</option><option>Female</option><option>Other</option></select></label>
            <label>Date of birth<input type="date" value={studentForm.date_of_birth} onChange={e => setStudentForm({ ...studentForm, date_of_birth: e.target.value })} /></label>
            <label>Religion<input value={studentForm.religion} onChange={e => setStudentForm({ ...studentForm, religion: e.target.value })} /></label>
            <label>Nationality<input value={studentForm.nationality} onChange={e => setStudentForm({ ...studentForm, nationality: e.target.value })} /></label>
            <label>Admission date<input type="date" value={studentForm.admission_date} onChange={e => setStudentForm({ ...studentForm, admission_date: e.target.value })} /></label>
            <label>Student phone<input value={studentForm.phone} onChange={e => setStudentForm({ ...studentForm, phone: e.target.value })} /></label>
            <label>Previous school<input value={studentForm.previous_school} onChange={e => setStudentForm({ ...studentForm, previous_school: e.target.value })} /></label>
            <label>Address<input value={studentForm.address} onChange={e => setStudentForm({ ...studentForm, address: e.target.value })} /></label>
          </div>
          <div className="form-section-title">Parent / guardian</div><div className="student-form-grid">
            <label>Guardian name<input value={studentForm.guardian_name} onChange={e => setStudentForm({ ...studentForm, guardian_name: e.target.value })} /></label>
            <label>Relationship<input value={studentForm.guardian_relationship} onChange={e => setStudentForm({ ...studentForm, guardian_relationship: e.target.value })} placeholder="Parent, aunt, guardian..." /></label>
            <label>Guardian phone<input value={studentForm.guardian_phone} onChange={e => setStudentForm({ ...studentForm, guardian_phone: e.target.value })} /></label>
          </div>
          <div className="form-section-title">Term fees (UGX) — optional</div><p className="form-hint">Enter the fees due for this student. Each amount is saved as a separate term charge; payments are recorded later in Fees & Finance.</p>
          <div className="student-form-grid"><label>Term 1 fees<input type="number" min="0" step="1" value={studentForm.term1_fee} onChange={e => setStudentForm({ ...studentForm, term1_fee: e.target.value })} placeholder="e.g. 350000" /></label><label>Term 2 fees<input type="number" min="0" step="1" value={studentForm.term2_fee} onChange={e => setStudentForm({ ...studentForm, term2_fee: e.target.value })} /></label><label>Term 3 fees<input type="number" min="0" step="1" value={studentForm.term3_fee} onChange={e => setStudentForm({ ...studentForm, term3_fee: e.target.value })} /></label></div>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowStudentForm(false)}>Cancel</button><button className="primary-button" disabled={savingStudent || !classes.length}>{savingStudent ? 'Saving...' : 'Save student'}</button></div></form>}
        <div className="table-tools register-tools"><div className="search-box"><Search size={17} /><input value={studentSearch} onChange={e => setStudentSearch(e.target.value)} placeholder="Search admission number or student name..." onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setStudentPage(1); void loadStudents(token, 1, studentSearch, studentClass, studentGender) } }} /></div><select value={studentClass} onChange={e => { setStudentClass(e.target.value); setStudentPage(1); void loadStudents(token, 1, studentSearch, e.target.value, studentGender) }}><option value="">All classes</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select value={studentGender} onChange={e => { setStudentGender(e.target.value); setStudentPage(1); void loadStudents(token, 1, studentSearch, studentClass, e.target.value) }}><option value="">All genders</option><option>Male</option><option>Female</option></select><button className="secondary-button" onClick={() => { setStudentSearch(''); setStudentClass(''); setStudentGender(''); void loadStudents(token, 1, '', '', '') }}>Clear</button><button className="secondary-button" onClick={() => void loadStudents(token, 1, studentSearch, studentClass, studentGender)}>Search</button></div>
        <StudentTable students={students.items} classes={classes} /><Pagination page={students.page} pages={students.pages} setPage={setStudentPage} /></section>}

      {active === 'Staff' && <section className="panel"><div className="panel-heading"><div><h2>Staff register</h2><p>{staff.total.toLocaleString()} staff members · Teaching and non-teaching</p></div><button className="primary-button add-student-button" onClick={() => setShowStaffForm(!showStaffForm)}><UserPlus size={16} /> {showStaffForm ? 'Close form' : 'Add staff member'}</button></div>
        {staffSuccess && <div className="success-notice">{staffSuccess}</div>}{staffError && <div className="form-error">{staffError}</div>}
        {showStaffForm && <form className="student-form" onSubmit={registerStaff}><div className="form-heading"><div><h3>New staff record</h3><p>Add teaching and non-teaching employees.</p></div></div><div className="student-form-grid">
          <label>Staff number *<input required value={staffForm.staff_number} onChange={e => setStaffForm({ ...staffForm, staff_number: e.target.value })} /></label>
          <label>First name *<input required value={staffForm.first_name} onChange={e => setStaffForm({ ...staffForm, first_name: e.target.value })} /></label>
          <label>Last name *<input required value={staffForm.last_name} onChange={e => setStaffForm({ ...staffForm, last_name: e.target.value })} /></label>
          <label>Category<select value={staffForm.category} onChange={e => setStaffForm({ ...staffForm, category: e.target.value })}><option>Teaching</option><option>Non-teaching</option></select></label>
          <label>Job title *<input required value={staffForm.job_title} onChange={e => setStaffForm({ ...staffForm, job_title: e.target.value })} placeholder="Teacher, bursar, cleaner..." /></label>
          <label>Department<input value={staffForm.department} onChange={e => setStaffForm({ ...staffForm, department: e.target.value })} /></label>
          <label>Phone<input value={staffForm.phone} onChange={e => setStaffForm({ ...staffForm, phone: e.target.value })} /></label>
          <label>Email<input type="email" value={staffForm.email} onChange={e => setStaffForm({ ...staffForm, email: e.target.value })} /></label>
        </div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowStaffForm(false)}>Cancel</button><button className="primary-button">Save staff member</button></div></form>}
        <div className="table-tools register-tools"><div className="search-box"><Search size={17} /><input value={staffSearch} onChange={e => setStaffSearch(e.target.value)} placeholder="Search staff name, number or job title..." onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setStaffPage(1); void loadStaff(token, 1, staffSearch, staffCategory) } }} /></div><select value={staffCategory} onChange={e => { setStaffCategory(e.target.value); void loadStaff(token, 1, staffSearch, e.target.value); setStaffPage(1) }}><option value="">All staff</option><option>Teaching</option><option>Non-teaching</option></select><button className="secondary-button" onClick={() => void loadStaff(token, 1, staffSearch, staffCategory)}>Search</button></div>
        <div className="table-wrap"><table><thead><tr><th>Staff number</th><th>Name</th><th>Category</th><th>Job title</th><th>Department</th><th>Phone</th><th>Status</th></tr></thead><tbody>{staff.items.map(s => <tr key={s.id}><td>{s.staff_number}</td><td><strong>{s.first_name} {s.last_name}</strong></td><td>{s.category}</td><td>{s.job_title}</td><td>{s.department || '—'}</td><td>{s.phone || '—'}</td><td>{s.employment_status}</td></tr>)}</tbody></table>{!staff.items.length && <EmptyState text="No staff members found." />}</div><Pagination page={staff.page} pages={staff.pages} setPage={setStaffPage} /></section>}

      {active === 'Fees & Finance' && <section className="panel"><div className="panel-heading"><div><h2>Fees and finance</h2><p>Student charges, instalment payments and balances · UGX</p></div></div>
        <div className="stats-grid finance-cards"><StatCard title="Fees expected" value={money(summary.fees_expected)} icon={<Wallet />} note="Total fee charges" /><StatCard title="Fees collected" value={money(summary.fees_collected)} icon={<Wallet />} note="Recorded payments" /><StatCard title="Outstanding" value={money(summary.outstanding)} icon={<Wallet />} note="Unpaid balances" /><StatCard title="Collection rate" value={summary.fees_expected ? `${Math.round(summary.fees_collected / summary.fees_expected * 100)}%` : '0%'} icon={<ShieldCheck />} note="Payments against charges" /></div>
        {financeError && <div className="form-error">{financeError}</div>}{financeSuccess && <div className="success-notice">{financeSuccess}</div>}
        <form className="finance-search" onSubmit={findFinanceStudent}><label>Find student account<input value={financeSearch} onChange={e => setFinanceSearch(e.target.value)} placeholder="Enter exact admission number or name" required /></label><button className="primary-button"><Search size={16} /> Find account</button></form>
        {financeLedger && <><div className="finance-ledger-heading"><div><h3>{financeLedger.student_name}</h3><p>Admission number: {financeLedger.admission_number}</p></div><div><span>Current balance</span><strong>{money(financeLedger.balance)}</strong></div></div>
          <div className="finance-summary"><div><span>Total charged</span><strong>{money(financeLedger.total_charged)}</strong></div><div><span>Total paid</span><strong>{money(financeLedger.total_paid)}</strong></div><div><span>Outstanding</span><strong>{money(financeLedger.balance)}</strong></div></div>
          <div className="form-section-title">Record a payment</div><form className="student-form" onSubmit={recordPayment}><div className="student-form-grid">
            <label>Academic year<input type="number" min="2000" max="2200" value={paymentForm.academic_year} onChange={e => setPaymentForm({ ...paymentForm, academic_year: Number(e.target.value) })} /></label>
            <label>Term<select value={paymentForm.term} onChange={e => setPaymentForm({ ...paymentForm, term: e.target.value })}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label>
            <label>Amount paid (UGX)<input type="number" min="1" step="1" required value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></label>
            <label>Payment method<select value={paymentForm.payment_method} onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}><option>Cash</option><option>Bank</option><option>Mobile Money</option><option>Cheque</option><option>Other</option></select></label>
            <label>Receipt / reference<input value={paymentForm.reference} onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })} /></label>
          </div><div className="form-actions"><button className="primary-button">Save payment</button></div></form>
          <div className="form-section-title">Payment history</div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Year</th><th>Term</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{financeLedger.payments.map((p: any) => <tr key={p.id}><td>{new Date(p.paid_at).toLocaleDateString()}</td><td>{p.year}</td><td>{p.term}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td>{money(p.amount)}</td></tr>)}</tbody></table>{!financeLedger.payments.length && <EmptyState text="No payments recorded for this student yet." />}</div>
          <div className="form-section-title">Fee charges</div><div className="table-wrap"><table><thead><tr><th>Year</th><th>Term</th><th>Description</th><th>Amount</th></tr></thead><tbody>{financeLedger.charges.map((c: any) => <tr key={c.id}><td>{c.year}</td><td>{c.term}</td><td>{c.description}</td><td>{money(c.amount)}</td></tr>)}</tbody></table>{!financeLedger.charges.length && <EmptyState text="No fee charges recorded." />}</div>
        </>}
      </section>}

      {active === 'Classes' && <section className="panel"><div className="panel-heading"><div><h2>School classes</h2><p>{classes.length} classes registered</p></div><button className="primary-button add-student-button" onClick={() => { setShowClassForm(!showClassForm); setClassError('') }}><Plus size={16} /> {showClassForm ? 'Close form' : 'Add class'}</button></div>{classError && <div className="form-error">{classError}</div>}{showClassForm && <form className="student-form" onSubmit={registerClass}><div className="student-form-grid"><label>Class name *<input required value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} placeholder="e.g. Primary 1" /></label><label>Section (optional)<input value={classForm.section} onChange={e => setClassForm({ ...classForm, section: e.target.value })} placeholder="e.g. East or A" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowClassForm(false)}>Cancel</button><button className="primary-button">Save class</button></div></form>}<div className="class-grid">{classes.map(c => <div className="class-card" key={c.id}><BookOpen size={22} /><strong>{c.name}</strong><span>{c.section || 'General section'}</span></div>)}</div>{!classes.length && <EmptyState text="No classes have been added yet." />}</section>}
      {active === 'Settings' && <section className="panel settings-panel"><div className="panel-heading"><div><h2>Admission number settings</h2><p>Choose the format used for new student registrations.</p></div></div>{settingsSuccess && <div className="success-notice">{settingsSuccess}</div>}{settingsError && <div className="form-error">{settingsError}</div>}<form className="student-form" onSubmit={saveAdmissionSettings}><div className="student-form-grid">
        <label>School prefix<input maxLength={20} value={admissionSettings.admission_prefix} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_prefix: e.target.value })} /></label>
        <label>Separator<select value={admissionSettings.admission_separator} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_separator: e.target.value })}><option value="-">Hyphen (-)</option><option value="/">Slash (/)</option><option value="">None</option></select></label>
        <label>Number of digits<select value={admissionSettings.admission_padding} onChange={e => setAdmissionSettings({ ...admissionSettings, admission_padding: Number(e.target.value) })}>{[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} digits</option>)}</select></label>
        <label>Next sequence number<input type="number" min="1" value={admissionSettings.next_admission_number} onChange={e => setAdmissionSettings({ ...admissionSettings, next_admission_number: Number(e.target.value) })} /></label>
        <label className="settings-checkbox"><input type="checkbox" checked={admissionSettings.include_year} onChange={e => setAdmissionSettings({ ...admissionSettings, include_year: e.target.checked })} /> Include current year</label>
      </div><div className="number-preview"><span>Example of next admission number</span><strong>{[admissionSettings.admission_prefix.trim(), ...(admissionSettings.include_year ? [String(new Date().getFullYear())] : []), String(admissionSettings.next_admission_number).padStart(admissionSettings.admission_padding, '0')].filter(Boolean).join(admissionSettings.admission_separator)}</strong></div><p className="form-hint">Existing admission numbers will not be changed.</p><div className="form-actions"><button className="primary-button" disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save settings'}</button></div></form></section>}
      {['Attendance', 'Examinations'].includes(active) && <ComingSoon title={active} description={active === 'Attendance' ? 'Daily attendance records and summaries will be managed here.' : 'Exam setup, marks entry and student results will be managed here.'} />}
      <footer className="footer"><span>SchoolBridge</span> · School management made simpler <span className="footer-version">Version 0.2 · Local workspace</span></footer>
      </div></main></div>
}

function StatCard({ title, value, icon, note }: { title: string; value: string | number; icon: React.ReactNode; note: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><small>{note}</small></div>
}
function StudentTable({ students, classes }: { students: Item[]; classes: Item[] }) {
  if (!students.length) return <EmptyState text="No student records found." />
  return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Gender</th><th>Class</th><th>Religion</th><th>Guardian</th><th>Guardian phone</th></tr></thead><tbody>{students.map(s => <tr key={s.id}><td><div className="student-cell"><div className="student-avatar">{(s.first_name || '?').slice(0,1).toUpperCase()}</div><strong>{s.first_name} {s.middle_name || ''} {s.last_name}</strong></div></td><td>{s.admission_number}</td><td>{s.gender || '—'}</td><td>{classes.find(c => c.id === s.class_id)?.name || '—'}</td><td>{s.religion || '—'}</td><td>{s.guardian_name || '—'}</td><td>{s.guardian_phone || '—'}</td></tr>)}</tbody></table></div>
}
function Pagination({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null
  return <div className="pagination"><span>Page {page} of {pages}</span><div><button className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /> Previous</button><button className="secondary-button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={15} /></button></div></div>
}
function EmptyState({ text }: { text: string }) { return <div className="empty-state"><GraduationCap size={30} /><p>{text}</p></div> }
function ComingSoon({ title, description }: { title: string; description: string }) { return <section className="panel coming-soon"><div className="coming-icon"><Settings size={28} /></div><h2>{title}</h2><p>{description}</p><span>Module in development</span></section> }
export default App
