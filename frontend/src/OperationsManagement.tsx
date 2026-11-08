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
type StaffAttendance = { id: number; staff_id: number; attendance_date: string; status: string; notes?: string; check_in_at?: string | null; check_out_at?: string | null }
type StaffAttendanceSummary = { total_staff: number; marked: number; unmarked: number; present: number; absent: number; late: number; excused: number }
type SchoolClass = { id: number; name: string; section?: string }
type Subject = { id: number; name: string; code?: string | null }
type TimetableEntry = { id: number; class_id: number; class_name?: string; class_section?: string; subject_id?: number | null; subject_name?: string; staff_id?: number | null; teacher_name?: string; day_of_week: number; start_time: string; end_time: string }

export default function OperationsManagement({ token, active, permissions = {}, isAdmin = false, roleLabel = '' }: { token: string; active: string; permissions?: Record<string, string[]>; isAdmin?: boolean; roleLabel?: string }) {
  const canEditTimetable = isAdmin || (['Academic Administrator','Academics Administrator','Academics Officer','Director of Studies','DOS'].includes(roleLabel.trim()) && ['add','edit','delete'].some(action => (permissions['Timetable'] || []).includes(action)))
  const canEditStaffAttendance = isAdmin || (permissions['Staff Attendance'] || []).includes('edit')
  const [staff, setStaff] = useState<Staff[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [staffStatuses, setStaffStatuses] = useState<Record<number, string>>({})
  const [staffDate, setStaffDate] = useState(today())
  const [staffRows, setStaffRows] = useState<StaffAttendance[]>([])
  const [staffMonthRows, setStaffMonthRows] = useState<StaffAttendance[]>([])
  const [staffTimeDrafts, setStaffTimeDrafts] = useState<Record<number, { checkIn: string; checkOut: string }>>({})
  const [staffSummary, setStaffSummary] = useState<StaffAttendanceSummary | null>(null)
  const [entries, setEntries] = useState<TimetableEntry[]>([])
  const [selectedTimetableClass, setSelectedTimetableClass] = useState('')
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null)
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
          request<{classes:SchoolClass[];subjects:Subject[];staff:Staff[]}>('timetable/options', token),
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
        const staffRows = await request<Staff[]>('staff-attendance/roster', token)
        setStaff(staffRows)
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
      const times: Record<number, { checkIn: string; checkOut: string }> = {}
      staff.forEach(person => {
        const record = rows.find(row => row.staff_id === person.id)
        values[person.id] = record?.status || ''
        times[person.id] = { checkIn: record?.check_in_at?.slice(11, 16) || '', checkOut: record?.check_out_at?.slice(11, 16) || '' }
      })
      setStaffStatuses(values); setStaffTimeDrafts(times)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load staff attendance.') }
  }

  async function loadTimetable() {
    try { setEntries(await request<TimetableEntry[]>('timetable', token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load timetable.') }
  }

  useEffect(() => { void loadSetup() }, [token, active, canEditTimetable])
  useEffect(() => { if (active === 'Staff Attendance' && staff.length) void loadStaffAttendance() }, [active, staff.length, staffDate])
  useEffect(() => {
    if (active !== 'Staff Attendance') return
    request<StaffAttendance[]>(`staff-attendance?month=${staffDate.slice(0, 7)}`, token)
      .then(setStaffMonthRows)
      .catch(e => setError(e instanceof Error ? e.message : 'Unable to load the attendance calendar.'))
  }, [active, staffDate.slice(0, 7), token])

  async function saveStaffRegister() {
    if (staff.some(person => !staffStatuses[person.id])) { setError('Select an attendance status for every staff member before saving the register.'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{ saved: number }>('staff-attendance/register', token, {
        method: 'PUT',
        body: JSON.stringify({ attendance_date: staffDate, records: staff.map(person => ({ staff_id: person.id, status: staffStatuses[person.id], check_in_time: staffTimeDrafts[person.id]?.checkIn || null, check_out_time: staffTimeDrafts[person.id]?.checkOut || null })) }),
      })
      setMessage(`${result.saved} staff attendance records saved for ${staffDate}.`)
      await loadStaffAttendance()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save staff attendance.') }
    finally { setSaving(false) }
  }

  async function addTimetableEntry(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await request<TimetableEntry>(editingEntryId ? 'timetable/' + editingEntryId : 'timetable', token, {
        method: editingEntryId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...draft, class_id: Number(draft.class_id), subject_id: draft.subject_id ? Number(draft.subject_id) : null,
          staff_id: draft.staff_id ? Number(draft.staff_id) : null, day_of_week: Number(draft.day_of_week),
        }),
      })
      setMessage(editingEntryId ? 'Timetable lesson updated.' : 'Lesson added to the class timetable.')
      setEditingEntryId(null)
      setDraft(old => ({ ...old, subject_id: '', staff_id: '' }))
      await loadTimetable()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add timetable entry.') }
    finally { setSaving(false) }
  }

  function beginEdit(entry: TimetableEntry) {
    setEditingEntryId(entry.id)
    setDraft({
      class_id: String(entry.class_id),
      subject_id: entry.subject_id ? String(entry.subject_id) : '',
      staff_id: entry.staff_id ? String(entry.staff_id) : '',
      day_of_week: String(entry.day_of_week),
      start_time: entry.start_time,
      end_time: entry.end_time,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
  const timetableDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const timetableClassId = Number(selectedTimetableClass || classes[0]?.id || 0)
  const timetableClassEntries = entries.filter(entry => entry.class_id === timetableClassId)
  const timetableSlots = Array.from(new Set(timetableClassEntries.map(entry => entry.start_time + '–' + entry.end_time))).sort()
  const timetableClass = classes.find(item => item.id === timetableClassId)

  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>{active === 'Staff Attendance' ? 'Staff attendance register' : 'School timetable'}</h2><p>{active === 'Staff Attendance' ? 'Record daily attendance for active teaching and non-teaching staff.' : 'Build and maintain a weekly timetable for each class.'}</p></div><button type="button" className="secondary-button" onClick={() => { void loadSetup(); if (active === 'Staff Attendance') void loadStaffAttendance() }} disabled={loading || saving}><RefreshCw size={15}/> Refresh</button></div>
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
        <div className="staff-attendance-calendar">
          <div className="staff-attendance-calendar-heading"><strong>Attendance calendar · {new Date(staffDate + 'T00:00:00').toLocaleDateString('en-UG', { month: 'long', year: 'numeric' })}</strong><span>{staffMonthRows.length} saved daily records</span></div>
          <div className="staff-attendance-calendar-days">
            {[...new Set(staffMonthRows.map(row => row.attendance_date))].sort((a,b) => b.localeCompare(a)).map(day => {
              const dayRows = staffMonthRows.filter(row => row.attendance_date === day)
              const present = dayRows.filter(row => row.status === 'Present').length
              return <button type="button" key={day} className={staffDate === day ? 'staff-calendar-day active' : 'staff-calendar-day'} onClick={() => setStaffDate(day)}>
                <strong>{new Date(day + 'T00:00:00').toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })}</strong><span>{dayRows.length} recorded · {present} present</span>
              </button>
            })}
            {!staffMonthRows.length && <span className="form-hint">No attendance records have been saved for this month yet.</span>}
          </div>
        </div>
        {loading ? <p className="form-hint">Loading staff...</p> : <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Staff number</th><th>Category</th><th>Check in</th><th>Check out</th><th>Status</th></tr></thead><tbody>
          {staffCategories.map(category => <Fragment key={category}>
            <tr className="staff-category-row"><td colSpan={4}>{category} staff <span>{staff.filter(person => (person.category || 'Other') === category).length}</span></td></tr>
            {staff.filter(person => (person.category || 'Other') === category).map(person => <tr key={person.id}><td><strong>{person.first_name} {person.last_name}</strong></td><td>{person.staff_number}</td><td>{person.category || 'Other'}</td><td>{canEditStaffAttendance ? <input aria-label={'Check-in time for ' + person.first_name} type="time" value={staffTimeDrafts[person.id]?.checkIn || ''} onChange={event => setStaffTimeDrafts(current => ({ ...current, [person.id]: { checkIn: event.target.value, checkOut: current[person.id]?.checkOut || '' } }))}/> : staffTimeDrafts[person.id]?.checkIn || '—'}</td><td>{canEditStaffAttendance ? <input aria-label={'Check-out time for ' + person.first_name} type="time" value={staffTimeDrafts[person.id]?.checkOut || ''} onChange={event => setStaffTimeDrafts(current => ({ ...current, [person.id]: { checkIn: current[person.id]?.checkIn || '', checkOut: event.target.value } }))}/> : staffTimeDrafts[person.id]?.checkOut || '—'}</td><td>{canEditStaffAttendance ? <div className="attendance-choice-group" role="group" aria-label={'Attendance for ' + person.first_name + ' ' + person.last_name}>{(['Present', 'Absent', 'Late', 'Excused'] as const).map(status => <button key={status} type="button" className={'attendance-choice attendance-' + status.toLowerCase() + (staffStatuses[person.id] === status ? ' selected' : '')} aria-pressed={staffStatuses[person.id] === status} onClick={() => setStaffStatuses(current => ({ ...current, [person.id]: status }))}>{status}</button>)}</div> : <span className="attendance-status-pill">{staffStatuses[person.id] || 'Not marked'}</span>}</td></tr>)}
          </Fragment>)}
          {!staff.length && <tr><td colSpan={4}>No active staff records found.</td></tr>}
        </tbody></table></div>}
        {canEditStaffAttendance && <div className="form-actions"><button className="primary-button" type="button" disabled={saving || !staff.length} onClick={() => void saveStaffRegister()}><Save size={15}/>{saving ? 'Saving...' : 'Save staff attendance'}</button></div>}
        {!canEditStaffAttendance && <p className="form-hint">View-only staff attendance access. You cannot change this register.</p>}
        <h3>Saved attendance · {staffDate}</h3>
        <p className="attendance-help">Self check-in times are submitted here for review. Authorised attendance administrators can revise check-in, check-out, notes and the final attendance status before saving.</p>
        <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Category</th><th>Check in</th><th>Check out</th><th>Recorded status</th><th>Notes</th></tr></thead><tbody>{staffRows.map(row => { const person = staff.find(item => item.id === row.staff_id); return <tr key={row.id}><td>{person ? person.first_name + ' ' + person.last_name : 'Staff #' + row.staff_id}</td><td>{person?.category || '—'}</td><td>{row.check_in_at?.slice(11,16) || '—'}</td><td>{row.check_out_at?.slice(11,16) || '—'}</td><td><span className={'attendance-status-pill status-' + row.status.toLowerCase()}>{row.status}</span></td><td>{row.notes || '—'}</td></tr> })}{!staffRows.length && <tr><td colSpan={6}>No saved staff attendance yet for this date.</td></tr>}</tbody></table></div>
      </> : <>
        <p className="attendance-help">A weekly class timetable. Choose a class to see its lessons arranged by weekday and period. Lesson cards show the subject, teacher and time.</p>
        {canEditTimetable && <details className="form-disclosure" open={editingEntryId !== null}><summary><Plus size={15}/> {editingEntryId ? "Edit lesson" : "Add a lesson"}</summary>
          <form className="student-form" onSubmit={addTimetableEntry}>
            <div className="student-form-grid">
              <label>Class *<select required value={draft.class_id} onChange={event => setDraft({ ...draft, class_id: event.target.value })}><option value="">Choose class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ' — ' + item.section : ''}</option>)}</select></label>
              <label>Subject<select value={draft.subject_id} onChange={event => setDraft({ ...draft, subject_id: event.target.value })}><option value="">Not specified</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
              <label>Teacher<select value={draft.staff_id} onChange={event => setDraft({ ...draft, staff_id: event.target.value })}><option value="">Not assigned</option>{staff.map(person => <option key={person.id} value={person.id}>{person.first_name} {person.last_name}</option>)}</select></label>
              <label>Day<select value={draft.day_of_week} onChange={event => setDraft({ ...draft, day_of_week: event.target.value })}>{dayNames.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
              <label>Start time<input required type="time" value={draft.start_time} onChange={event => setDraft({ ...draft, start_time: event.target.value })}/></label>
              <label>End time<input required type="time" value={draft.end_time} onChange={event => setDraft({ ...draft, end_time: event.target.value })}/></label>
            </div>
            <div className="form-actions"><button className="primary-button" disabled={saving || !classes.length}>{saving ? 'Saving...' : editingEntryId ? 'Save lesson changes' : 'Add lesson'}</button>{editingEntryId && <button type="button" className="secondary-button" onClick={() => {setEditingEntryId(null);setDraft({class_id:draft.class_id,subject_id:'',staff_id:'',day_of_week:'1',start_time:'08:00',end_time:'08:40'})}}>Cancel edit</button>}</div>
          </form>
        </details>}
        <div className="panel-heading"><div><h3>Weekly timetable</h3><p>Displayed as a weekday grid, with no room column.</p></div><span className="timetable-count">{entries.length} lessons</span></div>
        <label className="date-field">Class timetable<select value={selectedTimetableClass || (classes[0] ? String(classes[0].id) : '')} onChange={e=>setSelectedTimetableClass(e.target.value)}><option value="">Choose class</option>{classes.map(item=><option key={item.id} value={item.id}>{item.name}{item.section ? ' — '+item.section : ''}</option>)}</select></label>
        <div className="timetable-class-block">
          {timetableClass && <div className="timetable-class-heading"><h3>{timetableClass.name}{timetableClass.section ? ' — ' + timetableClass.section : ''}</h3><span>{timetableClassEntries.length} lessons this week</span></div>}
          <div className="table-wrap"><table className="class-timetable-table timetable-week-grid"><thead><tr><th>Period</th>{timetableDays.map(day=><th key={day}>{day}</th>)}</tr></thead><tbody>
            {timetableSlots.map(slot=><tr key={slot}><th>{slot}</th>{timetableDays.map((day,index)=>{
              const entry=timetableClassEntries.find(row=>row.day_of_week===index+1&&row.start_time+'–'+row.end_time===slot)
              return <td key={day}>{entry ? <div className="timetable-lesson-card"><strong>{entry.subject_name||'Lesson'}</strong><span>{entry.teacher_name||'Teacher not assigned'}</span><small>{entry.start_time}–{entry.end_time}</small>{canEditTimetable&&<div className="timetable-card-actions"><button type="button" className="secondary-button" disabled={saving} onClick={()=>beginEdit(entry)}>Edit</button><button type="button" className="secondary-button" disabled={saving} onClick={()=>void removeEntry(entry.id)}><Trash2 size={13}/> Remove</button></div>}</div> : <span className="timetable-empty-cell">—</span>}</td>
            })}</tr>)}
            {!timetableSlots.length&&<tr><td colSpan={6}>No lessons scheduled for this class.</td></tr>}
          </tbody></table></div>
        </div>
        {!classes.length && <p className="form-hint">No timetable classes are available.</p>}
        {!canEditTimetable && <p className="form-hint">View-only timetable access. Changes can be made only by the Academics Administrator or a designated academic officer.</p>}
      </>}
    </section>
  </div>
}
