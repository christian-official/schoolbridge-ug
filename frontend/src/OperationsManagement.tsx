import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
}
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }

type Staff = { id: number; first_name: string; last_name: string; staff_number: string; category: string; status: string }
type StaffAttendance = { id: number; staff_id: number; attendance_date: string; status: string; notes?: string }
type StaffAttendanceSummary = { total_staff: number; marked: number; unmarked: number; present: number; absent: number; late: number; excused: number }
type SchoolClass = { id: number; name: string; section?: string }
type Subject = { id: number; name: string }
type TimetableEntry = { id: number; class_id: number; subject_id?: number | null; staff_id?: number | null; day_of_week: number; start_time: string; end_time: string; room?: string | null }

export default function OperationsManagement({ token, active }: { token: string; active: string }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [staffStatuses, setStaffStatuses] = useState<Record<number, string>>({})
  const [staffDate, setStaffDate] = useState(today())
  const [staffRows, setStaffRows] = useState<StaffAttendance[]>([])
  const [staffSummary, setStaffSummary] = useState<StaffAttendanceSummary | null>(null)
  const [entries, setEntries] = useState<TimetableEntry[]>([])
  const [classId, setClassId] = useState('')
  const [draft, setDraft] = useState({ class_id: '', subject_id: '', staff_id: '', day_of_week: '1', start_time: '08:00', end_time: '08:40', room: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function loadSetup() {
    setLoading(true); setError('')
    try {
      const [staffResult, classResult, subjectResult] = await Promise.all([
        request<{ items: Staff[] }>('staff?page=1&page_size=100', token),
        request<SchoolClass[]>('classes', token),
        request<Subject[]>('subjects', token),
      ])
      setStaff(staffResult.items.filter(person => person.status === 'active'))
      setClasses(classResult); setSubjects(subjectResult)
      if (!classId && classResult.length) setClassId(String(classResult[0].id))
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load school operations.') }
    finally { setLoading(false) }
  }

  async function loadStaffAttendance() {
    try {
      const [rows, totals] = await Promise.all([
        request<StaffAttendance[]>(`staff-attendance?attendance_date=${staffDate}`, token),
        request<StaffAttendanceSummary>(`staff-attendance/summary?attendance_date=${staffDate}`, token),
      ])
      setStaffRows(rows); setStaffSummary(totals)
      const values: Record<number, string> = {}
      staff.forEach(person => { values[person.id] = rows.find(row => row.staff_id === person.id)?.status || 'Present' })
      setStaffStatuses(values)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load staff attendance.') }
  }

  async function loadTimetable(selected = classId) {
    if (!selected) { setEntries([]); return }
    try { setEntries(await request<TimetableEntry[]>(`timetable?class_id=${selected}`, token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load timetable.') }
  }

  useEffect(() => { void loadSetup() }, [token])
  useEffect(() => { if (active === 'Staff Attendance' && staff.length) void loadStaffAttendance() }, [active, staff.length, staffDate])
  useEffect(() => { if (active === 'Timetable') void loadTimetable() }, [active, classId])

  async function saveStaffRegister() {
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{ saved: number }>('staff-attendance/register', token, {
        method: 'PUT',
        body: JSON.stringify({ attendance_date: staffDate, records: staff.map(person => ({ staff_id: person.id, status: staffStatuses[person.id] || 'Present' })) }),
      })
      setMessage(`${result.saved} staff attendance records saved for ${staffDate}.`)
      await loadStaffAttendance()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save staff attendance.') }
    finally { setSaving(false) }
  }

  async function addTimetableEntry(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await request<TimetableEntry>('timetable', token, {
        method: 'POST',
        body: JSON.stringify({
          ...draft, class_id: Number(draft.class_id || classId), subject_id: draft.subject_id ? Number(draft.subject_id) : null,
          staff_id: draft.staff_id ? Number(draft.staff_id) : null, day_of_week: Number(draft.day_of_week), room: draft.room.trim() || null,
        }),
      })
      setMessage('Lesson added to the class timetable.')
      setDraft(old => ({ ...old, subject_id: '', staff_id: '', room: '' }))
      await loadTimetable(draft.class_id || classId)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add timetable entry.') }
    finally { setSaving(false) }
  }

  async function removeEntry(id: number) {
    if (!window.confirm('Remove this lesson from the timetable?')) return
    setSaving(true); setError('')
    try { await request(`timetable/${id}`, token, { method: 'DELETE' }); await loadTimetable() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to remove timetable entry.') }
    finally { setSaving(false) }
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const selectedClass = classes.find(item => String(item.id) === classId)

  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>{active === 'Staff Attendance' ? 'Staff attendance register' : 'School timetable'}</h2><p>{active === 'Staff Attendance' ? 'Record daily attendance for active teaching and non-teaching staff.' : 'Build and maintain a weekly timetable for each class.'}</p></div><button type="button" className="secondary-button" onClick={() => { void loadSetup(); if (active === 'Staff Attendance') void loadStaffAttendance(); else void loadTimetable() }} disabled={loading || saving}><RefreshCw size={15}/> Refresh</button></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      {active === 'Staff Attendance' ? <>
        <label>Attendance date<input type="date" value={staffDate} onChange={event => setStaffDate(event.target.value)}/></label>
        {staffSummary && <div className="stats-grid finance-stats">
          <div className="stat-card"><span>Active staff</span><strong className="stat-value">{staffSummary.total_staff}</strong></div>
          <div className="stat-card"><span>Present</span><strong className="stat-value">{staffSummary.present}</strong></div>
          <div className="stat-card"><span>Absent</span><strong className="stat-value">{staffSummary.absent}</strong></div>
          <div className="stat-card"><span>Late / Excused</span><strong className="stat-value">{staffSummary.late + staffSummary.excused}</strong></div>
          <div className="stat-card"><span>Not marked</span><strong className="stat-value">{staffSummary.unmarked}</strong></div>
        </div>}
        {loading ? <p className="form-hint">Loading staff...</p> : <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Staff number</th><th>Category</th><th>Status</th></tr></thead><tbody>
          {staff.map(person => <tr key={person.id}><td>{person.first_name} {person.last_name}</td><td>{person.staff_number}</td><td>{person.category}</td><td><select value={staffStatuses[person.id] || 'Present'} onChange={event => setStaffStatuses(current => ({ ...current, [person.id]: event.target.value }))}><option>Present</option><option>Absent</option><option>Late</option><option>Excused</option></select></td></tr>)}
          {!staff.length && <tr><td colSpan={4}>No active staff records found.</td></tr>}
        </tbody></table></div>}
        <div className="form-actions"><button className="primary-button" type="button" disabled={saving || !staff.length} onClick={() => void saveStaffRegister()}><Save size={15}/>{saving ? 'Saving...' : 'Save staff attendance'}</button></div>
        <h3>Saved attendance for {staffDate}</h3>
        <div className="table-wrap"><table><thead><tr><th>Staff ID</th><th>Status</th><th>Notes</th></tr></thead><tbody>{staffRows.map(row => <tr key={row.id}><td>{staff.find(person => person.id === row.staff_id)?.first_name || 'Staff'} #{row.staff_id}</td><td>{row.status}</td><td>{row.notes || '—'}</td></tr>)}{!staffRows.length && <tr><td colSpan={3}>No saved staff attendance yet for this date.</td></tr>}</tbody></table></div>
      </> : <>
        <label>Class<select value={classId} onChange={event => { setClassId(event.target.value); setDraft(old => ({ ...old, class_id: event.target.value })) }}><option value="">Choose class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ' — ' + item.section : ''}</option>)}</select></label>
        <details className="form-disclosure"><summary><Plus size={15}/> Add a lesson</summary>
          <form className="student-form" onSubmit={addTimetableEntry}>
            <div className="student-form-grid">
              <label>Class *<select required value={draft.class_id || classId} onChange={event => { setDraft({ ...draft, class_id: event.target.value }); setClassId(event.target.value) }}><option value="">Choose class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ' — ' + item.section : ''}</option>)}</select></label>
              <label>Subject<select value={draft.subject_id} onChange={event => setDraft({ ...draft, subject_id: event.target.value })}><option value="">Not specified</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
              <label>Teacher<select value={draft.staff_id} onChange={event => setDraft({ ...draft, staff_id: event.target.value })}><option value="">Not assigned</option>{staff.filter(person => person.category === 'Teaching').map(person => <option key={person.id} value={person.id}>{person.first_name} {person.last_name}</option>)}</select></label>
              <label>Day<select value={draft.day_of_week} onChange={event => setDraft({ ...draft, day_of_week: event.target.value })}>{dayNames.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
              <label>Start time<input required type="time" value={draft.start_time} onChange={event => setDraft({ ...draft, start_time: event.target.value })}/></label>
              <label>End time<input required type="time" value={draft.end_time} onChange={event => setDraft({ ...draft, end_time: event.target.value })}/></label>
              <label>Room / venue<input maxLength={60} value={draft.room} onChange={event => setDraft({ ...draft, room: event.target.value })}/></label>
            </div>
            <div className="form-actions"><button className="primary-button" disabled={saving || !classes.length}>{saving ? 'Saving...' : 'Add lesson'}</button></div>
          </form>
        </details>
        <div className="panel-heading"><div><h3>{selectedClass ? selectedClass.name + (selectedClass.section ? ' — ' + selectedClass.section : '') : 'Weekly timetable'}</h3><p>Monday to Friday · Lessons are checked for class-time overlaps.</p></div></div>
        {dayNames.map((day, index) => <div key={day} className="backup-action"><h3>{day}</h3><div className="table-wrap"><table><thead><tr><th>Time</th><th>Subject</th><th>Teacher</th><th>Room</th><th></th></tr></thead><tbody>
          {entries.filter(entry => entry.day_of_week === index + 1).map(entry => <tr key={entry.id}><td>{entry.start_time}–{entry.end_time}</td><td>{subjects.find(subject => subject.id === entry.subject_id)?.name || 'Lesson'}</td><td>{staff.find(person => person.id === entry.staff_id)?.first_name || '—'} {staff.find(person => person.id === entry.staff_id)?.last_name || ''}</td><td>{entry.room || '—'}</td><td><button type="button" className="secondary-button" disabled={saving} onClick={() => void removeEntry(entry.id)}><Trash2 size={14}/> Remove</button></td></tr>)}
          {!entries.some(entry => entry.day_of_week === index + 1) && <tr><td colSpan={5}>No lessons scheduled.</td></tr>}
        </tbody></table></div></div>)}
      </>}
    </section>
  </div>
}
