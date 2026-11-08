import { Fragment, useEffect, useState } from 'react'
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
type Subject = { id: number; name: string; code?: string | null }
type TimetableEntry = { id: number; class_id: number; class_name?: string; class_section?: string; subject_id?: number | null; subject_name?: string; staff_id?: number | null; teacher_name?: string; day_of_week: number; start_time: string; end_time: string }

export default function OperationsManagement({ token, active, permissions = {}, isAdmin = false, roleLabel = '' }: { token: string; active: string; permissions?: Record<string, string[]>; isAdmin?: boolean; roleLabel?: string }) {
  const canEditTimetable = isAdmin || (['Academic Administrator','Academics Administrator','Academics Officer','Director of Studies','DOS'].includes(roleLabel.trim()) && ['add','edit','delete'].some(action => (permissions['Timetable'] || []).includes(action)))
  const [staff, setStaff] = useState<Staff[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [staffStatuses, setStaffStatuses] = useState<Record<number, string>>({})
  const [staffDate, setStaffDate] = useState(today())
  const [staffRows, setStaffRows] = useState<StaffAttendance[]>([])
  const [staffSummary, setStaffSummary] = useState<StaffAttendanceSummary | null>(null)
  const [entries, setEntries] = useState<TimetableEntry[]>([])
  const [selectedTimetableClass, setSelectedTimetableClass] = useState('')
  const [draft, setDraft] = useState({ class_id: '', subject_id: '', staff_id: '', day_of_week: '1', start_time: '08:00', end_time: '08:40' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function loadSetup() {
    setLoading(true); setError('')
    try {
      if (active === 'Timetable') {
        const [rows, options] = await Promise.all([
          request<TimetableEntry[]>('timetable', token),
          canEditTimetable ? request<{classes:SchoolClass[];subjects:Subject[];staff:Staff[]}>('timetable/options', token) : Promise.resolve(null),
        ])
        setEntries(rows)
        if (options) {
          setClasses(options.classes); setSubjects(options.subjects); setStaff(options.staff)
          if (!draft.class_id && options.classes.length) setDraft(old => ({ ...old, class_id: String(options.classes[0].id) }))
        } else {
          const unique = Array.from(new Map(rows.map(row => [row.class_id, {id:row.class_id,name:row.class_name || 'Class',section:row.class_section || ''}])).values())
          setClasses(unique)
        }
      } else {
        const [staffResult] = await Promise.all([request<{ items: Staff[] }>('staff?page=1&page_size=100', token)])
        setStaff(staffResult.items.filter(person => person.status === 'active'))
      }
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
      staff.forEach(person => { values[person.id] = rows.find(row => row.staff_id === person.id)?.status || '' })
      setStaffStatuses(values)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load staff attendance.') }
  }

  async function loadTimetable() {
    try { setEntries(await request<TimetableEntry[]>('timetable', token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load timetable.') }
  }

  useEffect(() => { void loadSetup() }, [token, active, canEditTimetable])
  useEffect(() => { if (active === 'Staff Attendance' && staff.length) void loadStaffAttendance() }, [active, staff.length, staffDate])
  useEffect(() => { if (active === 'Timetable') void loadTimetable() }, [active, token])

  async function saveStaffRegister() {
    if (staff.some(person => !staffStatuses[person.id])) { setError('Select an attendance status for every staff member before saving the register.'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{ saved: number }>('staff-attendance/register', token, {
        method: 'PUT',
        body: JSON.stringify({ attendance_date: staffDate, records: staff.map(person => ({ staff_id: person.id, status: staffStatuses[person.id] })) }),
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
          ...draft, class_id: Number(draft.class_id), subject_id: draft.subject_id ? Number(draft.subject_id) : null,
          staff_id: draft.staff_id ? Number(draft.staff_id) : null, day_of_week: Number(draft.day_of_week),
        }),
      })
      setMessage('Lesson added to the class timetable.')
      setDraft(old => ({ ...old, subject_id: '', staff_id: '' }))
      await loadTimetable()
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
  const staffCategories = Array.from(new Set(staff.map(person => person.category || 'Other'))).sort((a, b) => a === 'Teaching' ? -1 : b === 'Teaching' ? 1 : a.localeCompare(b))

  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>{active === 'Staff Attendance' ? 'Staff attendance register' : 'School timetable'}</h2><p>{active === 'Staff Attendance' ? 'Record daily attendance for active teaching and non-teaching staff.' : 'Build and maintain a weekly timetable for each class.'}</p></div><button type="button" className="secondary-button" onClick={() => { void loadSetup(); if (active === 'Staff Attendance') void loadStaffAttendance(); else void loadTimetable() }} disabled={loading || saving}><RefreshCw size={15}/> Refresh</button></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      {active === 'Staff Attendance' ? <>
        <label className="date-field">Attendance date<input type="date" value={staffDate} onChange={event => setStaffDate(event.target.value)}/></label>
        <p className="attendance-help">Daily register: choose each staff member’s status, then save. The saved register below is the official status for the selected date.</p>
        {staffSummary && <div className="stats-grid finance-stats">
          <div className="stat-card"><span>Active staff</span><strong className="stat-value">{staffSummary.total_staff}</strong></div>
          <div className="stat-card"><span>Present</span><strong className="stat-value">{staffSummary.present}</strong></div>
          <div className="stat-card"><span>Absent</span><strong className="stat-value">{staffSummary.absent}</strong></div>
          <div className="stat-card"><span>Late / Excused</span><strong className="stat-value">{staffSummary.late + staffSummary.excused}</strong></div>
          <div className="stat-card"><span>Not marked</span><strong className="stat-value">{staffSummary.unmarked}</strong></div>
        </div>}
        {loading ? <p className="form-hint">Loading staff...</p> : <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Staff number</th><th>Category</th><th>Status</th></tr></thead><tbody>
          {staffCategories.map(category => <Fragment key={category}>
            <tr className="staff-category-row"><td colSpan={4}>{category} staff <span>{staff.filter(person => (person.category || 'Other') === category).length}</span></td></tr>
            {staff.filter(person => (person.category || 'Other') === category).map(person => <tr key={person.id}><td><strong>{person.first_name} {person.last_name}</strong></td><td>{person.staff_number}</td><td>{person.category || 'Other'}</td><td><div className="attendance-choice-group" role="group" aria-label={'Attendance for ' + person.first_name + ' ' + person.last_name}>{(['Present', 'Absent', 'Late', 'Excused'] as const).map(status => <button key={status} type="button" className={'attendance-choice attendance-' + status.toLowerCase() + (staffStatuses[person.id] === status ? ' selected' : '')} aria-pressed={staffStatuses[person.id] === status} onClick={() => setStaffStatuses(current => ({ ...current, [person.id]: status }))}>{status}</button>)}</div></td></tr>)}
          </Fragment>)}
          {!staff.length && <tr><td colSpan={4}>No active staff records found.</td></tr>}
        </tbody></table></div>}
        <div className="form-actions"><button className="primary-button" type="button" disabled={saving || !staff.length} onClick={() => void saveStaffRegister()}><Save size={15}/>{saving ? 'Saving...' : 'Save staff attendance'}</button></div>
        <h3>Saved attendance · {staffDate}</h3>
        <p className="attendance-help">Staff can verify their record by checking their name and status here. If a status is incorrect, ask the administrator to correct that date’s register. Individual staff sign-in confirmation is not yet enabled.</p>
        <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Category</th><th>Recorded status</th><th>Notes</th></tr></thead><tbody>{staffRows.map(row => { const person = staff.find(item => item.id === row.staff_id); return <tr key={row.id}><td>{person ? person.first_name + ' ' + person.last_name : 'Staff #' + row.staff_id}</td><td>{person?.category || '—'}</td><td><span className={'attendance-status-pill status-' + row.status.toLowerCase()}>{row.status}</span></td><td>{row.notes || '—'}</td></tr> })}{!staffRows.length && <tr><td colSpan={4}>No saved staff attendance yet for this date.</td></tr>}</tbody></table></div>
      </> : <>
        <p className="attendance-help">A weekly class timetable. Choose a class to see its lessons arranged by weekday and period. Lesson cards show the subject, teacher and time.</p>
        {canEditTimetable && <details className="form-disclosure"><summary><Plus size={15}/> Add a lesson</summary>
          <form className="student-form" onSubmit={addTimetableEntry}>
            <div className="student-form-grid">
              <label>Class *<select required value={draft.class_id} onChange={event => setDraft({ ...draft, class_id: event.target.value })}><option value="">Choose class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ' — ' + item.section : ''}</option>)}</select></label>
              <label>Subject<select value={draft.subject_id} onChange={event => setDraft({ ...draft, subject_id: event.target.value })}><option value="">Not specified</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
              <label>Teacher<select value={draft.staff_id} onChange={event => setDraft({ ...draft, staff_id: event.target.value })}><option value="">Not assigned</option>{staff.map(person => <option key={person.id} value={person.id}>{person.first_name} {person.last_name}</option>)}</select></label>
              <label>Day<select value={draft.day_of_week} onChange={event => setDraft({ ...draft, day_of_week: event.target.value })}>{dayNames.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
              <label>Start time<input required type="time" value={draft.start_time} onChange={event => setDraft({ ...draft, start_time: event.target.value })}/></label>
              <label>End time<input required type="time" value={draft.end_time} onChange={event => setDraft({ ...draft, end_time: event.target.value })}/></label>
            </div>
            <div className="form-actions"><button className="primary-button" disabled={saving || !classes.length}>{saving ? 'Saving...' : 'Add lesson'}</button></div>
          </form>
        </details>}
        <div className="panel-heading"><div><h3>Weekly timetable</h3><p>Displayed as a weekday grid, with no room column.</p></div><span className="timetable-count">{entries.length} lessons</span></div>
        <label className="date-field">Class timetable<select value={selectedTimetableClass || (classes[0] ? String(classes[0].id) : '')} onChange={e=>setSelectedTimetableClass(e.target.value)}><option value="">Choose class</option>{classes.map(item=><option key={item.id} value={item.id}>{item.name}{item.section ? ' — '+item.section : ''}</option>)}</select></label>
        {(() => {
          const classId = Number(selectedTimetableClass || classes[0]?.id || 0)
          const classEntries = entries.filter(entry => entry.class_id === classId)
          const slots = Array.from(new Set(classEntries.map(entry => entry.start_time + '–' + entry.end_time))).sort()
          const days = ['Mon','Tue','Wed','Thu','Fri']
          const chosenClass = classes.find(item => item.id === classId)
          return <div className="timetable-class-block">
            {chosenClass && <div className="timetable-class-heading"><h3>{chosenClass.name}{chosenClass.section ? ' — ' + chosenClass.section : ''}</h3><span>{classEntries.length} lessons this week</span></div>}
            <div className="table-wrap"><table className="class-timetable-table timetable-week-grid"><thead><tr><th>Period</th>{days.map(day=><th key={day}>{day}</th>)}</tr></thead><tbody>
              {slots.map(slot => <tr key={slot}><th>{slot}</th>{days.map((day,index) => {
                const entry = classEntries.find(row => row.day_of_week === index + 1 && row.start_time + '–' + row.end_time === slot)
                return <td key={day}>{entry ? <div className="timetable-lesson-card"><strong>{entry.subject_name || 'Lesson'}</strong><span>{entry.teacher_name || 'Teacher not assigned'}</span><small>{entry.start_time}–{entry.end_time}</small>{canEditTimetable && <button type="button" className="secondary-button" disabled={saving} onClick={() => void removeEntry(entry.id)}><Trash2 size={13}/> Remove</button>}</div> : <span className="timetable-empty-cell">—</span>}</td>
              })}</tr>)}
              {!slots.length && <tr><td colSpan={6}>No lessons scheduled for this class.</td></tr>}
            </tbody></table></div>
          </div>
        })()}
        {!classes.length && <p className="form-hint">No timetable classes are available.</p>}
        {!canEditTimetable && <p className="form-hint">View-only timetable access. Changes can be made only by the Academics Administrator or a designated academic officer.</p>}

