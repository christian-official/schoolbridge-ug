import { useEffect, useState } from 'react'
import { Bell, GraduationCap, Wallet, Users, PlusCircle } from 'lucide-react'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
}

type StudentOption = { id: number; first_name: string; middle_name?: string | null; last_name: string; admission_number: string; class_id?: number | null; guardian_name?: string | null; guardian_relationship?: string | null; guardian_phone?: string | null }
type ParentChild = { id: number; name: string; admission_number: string; status: string; class_name: string; stream: string; fees_charged: number; fees_paid: number; balance: number }
type Announcement = { id: number; title: string; message: string; audience: string; published: boolean; created_at: string }
type ChildResult = { exam: string; term: string; year: number; subject: string; score: number }
type ChildAttendance = { date: string; status: string }
type ChildFee = { term: string; year: number; charged: number; paid: number; balance: number; payments: { date: string; amount: number; receipt_number?: string | null }[] }

export default function Phase4Workspace({ token, role, active, permissions }: { token: string; role: string; active: string; permissions?: Record<string, string[]> }) {
  const canPublish = role === 'admin' || (permissions?.Announcements || []).includes('add')
  const [students, setStudents] = useState<StudentOption[]>([])
  const [parents, setParents] = useState<any[]>([])
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([])
  const [studentSearch, setStudentSearch] = useState('')
  const [account, setAccount] = useState({ username: '', email: '' })
  const [issuedPasscode, setIssuedPasscode] = useState<{ username: string; email: string; password: string; emailSent: boolean; emailError?: string; phone: string } | null>(null)
  const [savingAccount, setSavingAccount] = useState(false)
  const [children, setChildren] = useState<ParentChild[]>([])
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null)
  const [childTab, setChildTab] = useState<'results' | 'attendance' | 'fees'>('results')
  const [results, setResults] = useState<ChildResult[]>([])
  const [attendance, setAttendance] = useState<ChildAttendance[]>([])
  const [fees, setFees] = useState<ChildFee[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [announcement, setAnnouncement] = useState({ title: '', message: '', audience: 'All' })
  const [savingAnnouncement, setSavingAnnouncement] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadAdminParents() {
    const [studentData, parentData] = await Promise.all([
      api<{ items: StudentOption[] }>('students/search?page=1&page_size=5&search='+encodeURIComponent(studentSearch.trim()), token),
      api<any[]>('parent-accounts', token),
    ])
    setStudents(studentData.items || [])
    setParents(parentData)
  }

  useEffect(() => {
    if (role === 'parent' || active !== 'Parent Access') return
    let cancelled = false
    api<any[]>('parent-accounts', token).then(rows => { if (!cancelled) setParents(rows) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load parent accounts.') })
    return () => { cancelled = true }
  }, [token, role, active])

  useEffect(() => {
    let cancelled = false
    setError('')
    if (role !== 'parent' && active === 'Parent Access') {
      setBusy(true)
      api<{ items: StudentOption[] }>('students/search?page=1&page_size=5&search='+encodeURIComponent(studentSearch.trim()), token)
        .then(studentData => { if (!cancelled) setStudents(studentData.items || []) })
        .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to search students.') })
        .finally(() => { if (!cancelled) setBusy(false) })
    }
    if (active === 'Announcements') {
      setBusy(true)
      api<Announcement[]>('announcements', token).then(rows => { if (!cancelled) setAnnouncements(rows) })
        .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load announcements.') })
        .finally(() => { if (!cancelled) setBusy(false) })
    }
    if (role === 'parent' && active === 'My Children') {
      setBusy(true)
      api<ParentChild[]>('parent/children', token).then(rows => {
        if (cancelled) return
        setChildren(rows)
        setSelectedChildId(current => current && rows.some(row => row.id === current) ? current : rows[0]?.id ?? null)
      }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load linked students.') })
        .finally(() => { if (!cancelled) setBusy(false) })
    }
    return () => { cancelled = true }
  }, [token, role, active, studentSearch])

  useEffect(() => {
    if (role !== 'parent' || active !== 'My Children' || selectedChildId === null) return
    let cancelled = false
    setBusy(true); setError('')
    const path = `parent/children/${selectedChildId}/`
    const requests = childTab === 'results' ? api<ChildResult[]>(path + 'results', token).then(rows => { if (!cancelled) setResults(rows) })
      : childTab === 'attendance' ? api<ChildAttendance[]>(path + 'attendance', token).then(rows => { if (!cancelled) setAttendance(rows) })
      : api<ChildFee[]>(path + 'fees', token).then(rows => { if (!cancelled) setFees(rows) })
    requests.catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load this student record.') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [token, role, active, selectedChildId, childTab])

  async function createParentAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudentIds.length) { setError('Select at least one student to link to this parent.'); return }
    setSavingAccount(true); setError(''); setMessage('')
    try {
      const created = await api<{ username: string; email: string; temporary_password: string; email_sent?: boolean; email_error?: string }>('parent-accounts', token, { method: 'POST', body: JSON.stringify({ ...account, student_ids: selectedStudentIds }) })
      const guardianPhones = [...new Set(students.filter(student => selectedStudentIds.includes(student.id)).map(student => student.guardian_phone?.trim()).filter(Boolean))]
      setIssuedPasscode({ username: created.username, email: created.email, password: created.temporary_password, emailSent: !!created.email_sent, emailError: created.email_error, phone: guardianPhones.join(', ') })
      setAccount({ username: '', email: '' }); setSelectedStudentIds([]); setStudentSearch('')
      await loadAdminParents()
      setMessage('Parent account created. Copy the temporary passcode and give it securely to the parent.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create parent account.') }
    finally { setSavingAccount(false) }
  }

  async function publishAnnouncement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingAnnouncement(true); setError(''); setMessage('')
    try {
      await api('announcements', token, { method: 'POST', body: JSON.stringify({ ...announcement, published: true }) })
      setAnnouncement({ title: '', message: '', audience: 'All' })
      setAnnouncements(await api<Announcement[]>('announcements', token))
      setMessage('Announcement published successfully.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to publish announcement.') }
    finally { setSavingAnnouncement(false) }
  }

  if (role !== 'parent' && active === 'Parent Access') return <div className="phase4-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2><Users size={20}/> Parent account management</h2><p>Create secure parent logins and link each account to one or more registered students.</p></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="success-notice" role="status">{message}</div>}
      {issuedPasscode && <div className="success-notice parent-passcode-handover" role="status">
        <strong>Parent login passcode — show this to the parent now</strong>
        <p>Username: <strong>{issuedPasscode.username}</strong></p>
        <p>Email: {issuedPasscode.email}</p>
        <p>Temporary passcode: <strong>{issuedPasscode.password}</strong></p>
        <p><strong>Email delivery:</strong> {issuedPasscode.emailSent ? 'Sent successfully.' : 'Not sent automatically.'}</p>
        {!issuedPasscode.emailSent && <small>{issuedPasscode.emailError || 'Configure SMTP on the school server to send email automatically.'}</small>}
        <p><strong>Registered guardian phone:</strong> {issuedPasscode.phone || 'No phone number was saved for the selected guardian.'}</p>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={() => void navigator.clipboard?.writeText('SchoolBridge parent login\nUsername: '+issuedPasscode.username+'\nTemporary passcode: '+issuedPasscode.password)}>Copy login details</button>
          {issuedPasscode.phone && <button type="button" className="secondary-button" onClick={() => void navigator.clipboard?.writeText('Your SchoolBridge parent account is ready. Username: '+issuedPasscode.username+'. Temporary passcode: '+issuedPasscode.password+'. Sign in to the school portal and change your passcode.')}>Copy SMS message</button>}
          <button type="button" className="secondary-button" onClick={() => { const cleanup = () => { delete document.body.dataset.schoolbridgePrint }; document.body.dataset.schoolbridgePrint = "handover"; window.addEventListener("afterprint", cleanup, { once: true }); window.print() }}>Print handover details</button>
        </div>
        <small>This passcode is shown only once. Share it securely and ask the parent to change it after signing in. SMS sending requires a configured provider; copying or printing is available without SMS charges.</small>
      </div>}
      <form className="student-form" onSubmit={createParentAccount}>
        <div className="student-form-grid">
          <label>Find student by name or admission number<input type="search" value={studentSearch} onChange={e => setStudentSearch(e.target.value)} placeholder="Search registered students"/></label>
          <label>Parent / guardian name<input readOnly value={[...new Set(students.filter(student => selectedStudentIds.includes(student.id)).map(student => student.guardian_name).filter(Boolean))].join(', ')} placeholder="Automatically taken from student registration"/><small>Loaded from the selected student's registration record.</small></label>
          <label>Parent username *<input required minLength={3} value={account.username} onChange={e => setAccount({ ...account, username: e.target.value })}/></label>
          <label>Parent email *<input required type="email" value={account.email} onChange={e => setAccount({ ...account, email: e.target.value })}/></label>
        </div>
        <div className="phase4-student-picker">
          <strong>Choose registered student(s) to link *</strong>
          <small>Student and guardian details are already stored in registration. Tick the student(s) belonging to this parent.</small>
          <div className="phase4-student-options">
            {!studentSearch.trim() && <p className="form-hint">Type a student name or admission number to find and select a student.</p>}
            {studentSearch.trim() && students.filter(student => (student.first_name + ' ' + (student.middle_name || '') + ' ' + student.last_name + ' ' + student.admission_number).toLowerCase().includes(studentSearch.trim().toLowerCase())).map(student => <label className="subject-choice" key={student.id}>
              <input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={e => {
                setSelectedStudentIds(current => e.target.checked ? [...current, student.id] : current.filter(id => id !== student.id))
                if (e.target.checked && student.guardian_name && !account.username.trim()) setAccount(current => ({ ...current, username: student.guardian_name!.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.') }))
              }}/>
              <span><strong>{student.first_name} {student.middle_name || ''} {student.last_name}</strong> · {student.admission_number}<small>Guardian: {student.guardian_name || 'Not recorded'}{student.guardian_relationship ? ' · ' + student.guardian_relationship : ''}{student.guardian_phone ? ' · ' + student.guardian_phone : ''}</small></span>
            </label>)}
            {studentSearch.trim() && students.length > 0 && !students.some(student => (student.first_name + ' ' + (student.middle_name || '') + ' ' + student.last_name + ' ' + student.admission_number).toLowerCase().includes(studentSearch.trim().toLowerCase())) && <p className="form-hint">No students match that search.</p>}
            {!students.length && <p className="form-hint">No registered students are available.</p>}
          </div>
          <small>{selectedStudentIds.length} student(s) selected.</small>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={savingAccount}>{savingAccount ? 'Creating account...' : 'Create parent account'}</button></div>
      </form>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Registered parent accounts</h2><p>Review which students are linked to each parent login.</p></div><span className="count-pill">{parents.length} accounts</span></div>
      <div className="table-wrap"><table><thead><tr><th>Username</th><th>Email</th><th>Linked students</th><th>Account status</th></tr></thead><tbody>
        {parents.map(parent => <tr key={parent.id}><td>{parent.username}</td><td>{parent.email}</td><td>{parent.children?.map((child: any) => child.name + ' (' + child.admission_number + ')').join(', ') || 'No linked students'}</td><td>{parent.active ? 'Active' : 'Disabled'}</td></tr>)}
        {!parents.length && <tr><td colSpan={4}>{busy ? 'Loading parent accounts...' : 'No parent accounts have been created yet.'}</td></tr>}
      </tbody></table></div>
    </section>
  </div>

  if (active === 'Announcements') return <div className="phase4-workspace">
    {canPublish && <section className="panel">
      <div className="panel-heading"><div><h2><PlusCircle size={20}/> Publish school announcement</h2><p>Share school updates with parents, teachers or everyone.</p></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="success-notice" role="status">{message}</div>}
      <form className="student-form" onSubmit={publishAnnouncement}>
        <div className="student-form-grid">
          <label>Announcement title *<input required minLength={3} maxLength={160} value={announcement.title} onChange={e => setAnnouncement({ ...announcement, title: e.target.value })}/></label>
          <label>Audience<select value={announcement.audience} onChange={e => setAnnouncement({ ...announcement, audience: e.target.value })}><option>All</option><option>Parents</option><option>Teachers</option></select></label>
          <label className="phase4-announcement-message">Message *<textarea required minLength={3} maxLength={5000} rows={5} value={announcement.message} onChange={e => setAnnouncement({ ...announcement, message: e.target.value })}/></label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={savingAnnouncement}>{savingAnnouncement ? 'Publishing...' : 'Publish announcement'}</button></div>
      </form>
    </section>}
    <section className="panel">
      <div className="panel-heading"><div><h2><Bell size={20}/> School announcements</h2><p>{canPublish ? 'Published and draft school updates.' : 'Updates shared by your school.'}</p></div></div>
      {error && !canPublish && <div className="form-error" role="alert">{error}</div>}
      {announcements.map(item => <article className="phase4-announcement" key={item.id}><div><strong>{item.title}</strong><span>{item.audience} · {new Date(item.created_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div><p>{item.message}</p></article>)}
      {!announcements.length && <div className="empty-state">{busy ? 'Loading announcements...' : 'There are no announcements yet.'}</div>}
    </section>
  </div>

  if (role === 'parent' && active === 'My Children') {
    const child = children.find(row => row.id === selectedChildId)
    return <div className="phase4-workspace">
      {error && <div className="form-error" role="alert">{error}</div>}
      <section className="panel">
        <div className="panel-heading"><div><h2><GraduationCap size={20}/> My children</h2><p>View academic progress, attendance and school fee balances for linked students.</p></div><span className="count-pill">{children.length} linked</span></div>
        <div className="phase4-child-list">{children.map(row => <button type="button" key={row.id} className={selectedChildId === row.id ? 'phase4-child-card active' : 'phase4-child-card'} onClick={() => setSelectedChildId(row.id)}><strong>{row.name}</strong><span>{row.class_name}{row.stream ? ' · ' + row.stream : ''} · {row.admission_number}</span><b>Outstanding: UGX {row.balance.toLocaleString('en-UG')}</b></button>)}</div>
        {!children.length && <div className="empty-state">{busy ? 'Loading linked student records...' : 'No student has been linked to this parent account. Contact the school administrator.'}</div>}
      </section>
      {child && <section className="panel">
        <div className="panel-heading"><div><h2>{child.name}</h2><p>{child.class_name}{child.stream ? ' · ' + child.stream : ''} · {child.admission_number}</p></div></div>
        <div className="phase4-summary-grid"><div><Wallet size={19}/><span>Fees charged</span><strong>UGX {child.fees_charged.toLocaleString('en-UG')}</strong></div><div><Wallet size={19}/><span>Fees paid</span><strong>UGX {child.fees_paid.toLocaleString('en-UG')}</strong></div><div><Wallet size={19}/><span>Outstanding</span><strong>UGX {child.balance.toLocaleString('en-UG')}</strong></div></div>
        <div className="phase4-tabs"><button className={childTab === 'results' ? 'active' : ''} onClick={() => setChildTab('results')}>Academic results</button><button className={childTab === 'attendance' ? 'active' : ''} onClick={() => setChildTab('attendance')}>Attendance</button><button className={childTab === 'fees' ? 'active' : ''} onClick={() => setChildTab('fees')}>Fee statement</button></div>
        {busy && <p className="form-hint">Loading selected record...</p>}
        {childTab === 'results' && <div className="table-wrap"><table><thead><tr><th>Examination</th><th>Term / Year</th><th>Subject</th><th>Verified score</th></tr></thead><tbody>{results.map((row, i) => <tr key={i}><td>{row.exam}</td><td>{row.term} {row.year}</td><td>{row.subject}</td><td>{row.score}</td></tr>)}{!results.length && <tr><td colSpan={4}>No verified examination results are available yet.</td></tr>}</tbody></table></div>}
        {childTab === 'attendance' && <div className="table-wrap"><table><thead><tr><th>Date</th><th>Attendance status</th></tr></thead><tbody>{attendance.map((row, i) => <tr key={i}><td>{new Date(row.date + 'T00:00:00').toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>{row.status}</td></tr>)}{!attendance.length && <tr><td colSpan={2}>No attendance records are available yet.</td></tr>}</tbody></table></div>}
        {childTab === 'fees' && <div className="table-wrap"><table><thead><tr><th>Term / Year</th><th>Charged</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{fees.map((row, i) => <tr key={i}><td>{row.term} {row.year}</td><td>UGX {row.charged.toLocaleString('en-UG')}</td><td>UGX {row.paid.toLocaleString('en-UG')}</td><td>UGX {row.balance.toLocaleString('en-UG')}</td></tr>)}{!fees.length && <tr><td colSpan={4}>No fee statements are available yet.</td></tr>}</tbody></table></div>}
      </section>}
    </div>
  }
  return null
}
