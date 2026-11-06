import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  ClipboardCheck, FileText, Settings, LogOut,
  Search, Bell, Plus, Menu, X, ArrowUpRight,
  CalendarDays, TrendingUp, ShieldCheck, LoaderCircle,
} from 'lucide-react'
import './App.css'

type User = {
  id: number
  username: string
  email: string
  role: string
  active: boolean
}

type RecordItem = {
  id: number
  name?: string
  first_name?: string
  last_name?: string
  admission_number?: string
  section?: string
  gender?: string
}

const menu = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Students', icon: GraduationCap },
  { label: 'Teachers', icon: Users },
  { label: 'Classes', icon: BookOpen },
  { label: 'Attendance', icon: ClipboardCheck },
  { label: 'Examinations', icon: FileText },
]

async function api<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json()
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
  const [classes, setClasses] = useState<RecordItem[]>([])
  const [subjects, setSubjects] = useState<RecordItem[]>([])
  const [dataError, setDataError] = useState('')
  const [search, setSearch] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)

  async function loadSchoolData(authToken: string) {
    setDataError('')
    try {
      const [studentData, classData, subjectData] = await Promise.all([
        api<RecordItem[]>('students', authToken),
        api<RecordItem[]>('classes', authToken),
        api<RecordItem[]>('subjects', authToken),
      ])
      setStudents(studentData)
      setClasses(classData)
      setSubjects(subjectData)
    } catch {
      setDataError('Some school records could not be loaded. Check your connection and permissions.')
    }
  }

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

  const filteredStudents = students.filter((student) => {
    const name = `${student.first_name || ''} ${student.last_name || ''} ${student.admission_number || ''}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })

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
                  <div className="panel-heading"><div><h2>Recent students</h2><p>Latest registered student records</p></div><button className="text-button" onClick={() => setActive('Students')}>View all <ArrowUpRight size={15} /></button></div>
                  <StudentTable students={students.slice(-5).reverse()} />
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
              <div className="panel-heading"><div><h2>Student records</h2><p>{students.length} registered students</p></div><span className="record-count"><Users size={16} /> {students.length} records</span></div>
              <div className="table-tools"><div className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or admission number..." /></div></div>
              <StudentTable students={filteredStudents} />
            </section>
          )}

          {active === 'Classes' && (
            <section className="panel">
              <div className="panel-heading"><div><h2>School classes</h2><p>Classes registered in the system</p></div><span className="record-count">{classes.length} classes</span></div>
              <div className="class-grid">{classes.map(item => <div className="class-card" key={item.id}><BookOpen size={22} /><strong>{item.name}</strong><span>{item.section || 'General section'}</span></div>)}</div>
              {classes.length === 0 && <EmptyState text="No classes have been added yet." />}
            </section>
          )}

          {active === 'Teachers' && <ComingSoon title="Teacher management" description="Teacher accounts and class assignments will be managed here." />}
          {active === 'Attendance' && <ComingSoon title="Attendance management" description="Daily attendance records and summaries will appear here." />}
          {active === 'Examinations' && <ComingSoon title="Examinations and results" description="Exam setup, marks entry and student results will be managed here." />}
          {active === 'Settings' && <ComingSoon title="School settings" description="Configure your school profile, preferences and system options." />}

          <footer className="footer"><span>SchoolBridge</span> · School management made simpler <span className="footer-version">Version 0.1 · Local workspace</span></footer>
        </div>
      </main>
    </div>
  )
}

function StatCard({ title, value, icon, note }: { title: string; value: string | number; icon: React.ReactNode; note: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><small><TrendingUp size={14} /> {note}</small></div>
}

function StudentTable({ students }: { students: RecordItem[] }) {
  if (!students.length) return <EmptyState text="No student records to display yet." />
  return (
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Gender</th><th>Class ID</th></tr></thead><tbody>
      {students.map(student => <tr key={student.id}><td><div className="student-cell"><div className="student-avatar">{(student.first_name || '?').slice(0, 1).toUpperCase()}</div><strong>{student.first_name} {student.last_name}</strong></div></td><td>{student.admission_number}</td><td>{student.gender || '—'}</td><td>{student.id ? student.id : '—'}</td></tr>)}
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
