import { useEffect, useMemo, useState } from 'react'
import { Printer, RefreshCw, Save } from 'lucide-react'

type SchoolClass = { id: number; name: string; section?: string }
type Student = { id: number; first_name: string; last_name: string; admission_number: string; class_id: number | null; status?: string }
type Attendance = { id: number; student_id: number; attendance_date: string; status: string }
type Summary = { total_students: number; marked: number; unmarked: number; present: number; absent: number; late: number; excused: number; attendance_rate: number }

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const today = () => new Date().toISOString().slice(0, 10)

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
}

export default function AttendanceManagement({ token }: { token: string }) {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [statuses, setStatuses] = useState<Record<number, string>>({})
  const [classId, setClassId] = useState('')
  const [attendanceDate, setAttendanceDate] = useState(today())
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true); setError('')
    try {
      const [classRows, firstPage] = await Promise.all([
        request<SchoolClass[]>('classes', token),
        request<{ items: Student[]; pages: number }>('students/search?page=1&page_size=100', token),
      ])
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, firstPage.pages - 1) }, (_, index) =>
          request<{ items: Student[] }>(`students/search?page=${index + 2}&page_size=100`, token)
        )
      )
      setClasses(classRows)
      setStudents([...firstPage.items, ...remainingPages.flatMap(page => page.items)]
        .filter(student => student.status === 'active' && student.class_id !== null))
      if (!classId && classRows.length) setClassId(String(classRows[0].id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load class registers.')
    } finally { setLoading(false) }
  }

  async function loadRegister(selectedClass = classId, selectedDate = attendanceDate) {
    if (!selectedClass) { setSummary(null); return }
    setLoading(true); setError('')
    try {
      const [rows, totals] = await Promise.all([
        request<Attendance[]>(`attendance?class_id=${selectedClass}&attendance_date=${selectedDate}`, token),
        request<Summary>(`attendance/summary?class_id=${selectedClass}&attendance_date=${selectedDate}`, token),
      ])
      setSummary(totals)
      const byStudent = Object.fromEntries(rows.map(row => [row.student_id, row.status]))
      setStatuses(() => {
        const next: Record<number, string> = {}
        students.filter(student => String(student.class_id) === selectedClass).forEach(student => {
          next[student.id] = byStudent[student.id] || 'Present'
        })
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load attendance register.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [token])
  useEffect(() => { if (students.length) void loadRegister() }, [classId, attendanceDate, students.length])

  const classStudents = useMemo(() => students.filter(student => String(student.class_id) === classId).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)), [students, classId])

  async function saveRegister() {
    if (!classId || !classStudents.length) return
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{ saved: number; message: string }>('attendance/register', token, {
        method: 'PUT',
        body: JSON.stringify({
          class_id: Number(classId),
          attendance_date: attendanceDate,
          records: classStudents.map(student => ({ student_id: student.id, status: statuses[student.id] || 'Present' })),
        }),
      })
      setMessage(`${result.saved} student attendance records saved for ${attendanceDate}.`)
      await loadRegister()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save the class register.')
    } finally { setSaving(false) }
  }

  const selectedClass = classes.find(item => String(item.id) === classId)

  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading">
        <div><h2>Daily student attendance</h2><p>Take a class register, correct attendance and review daily totals.</p></div>
        <button type="button" className="secondary-button" onClick={() => { void load(); void loadRegister() }} disabled={loading || saving}><RefreshCw size={15}/> Refresh</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      <div className="student-form-grid">
        <label>Class *
          <select value={classId} onChange={event => setClassId(event.target.value)}>
            <option value="">Choose class</option>
            {classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ' — ' + item.section : ''}</option>)}
          </select>
        </label>
        <label>Attendance date *
          <input type="date" value={attendanceDate} onChange={event => setAttendanceDate(event.target.value)} />
        </label>
      </div>
    </section>

    {summary && <section className="stats-grid finance-stats">
      <div className="stat-card"><span>Class size</span><strong className="stat-value">{summary.total_students}</strong></div>
      <div className="stat-card"><span>Present</span><strong className="stat-value">{summary.present}</strong></div>
      <div className="stat-card"><span>Absent</span><strong className="stat-value">{summary.absent}</strong></div>
      <div className="stat-card"><span>Late / Excused</span><strong className="stat-value">{summary.late + summary.excused}</strong></div>
      <div className="stat-card"><span>Not marked</span><strong className="stat-value">{summary.unmarked}</strong></div>
      <div className="stat-card"><span>Attendance rate</span><strong className="stat-value">{summary.attendance_rate.toFixed(1)}%</strong></div>
    </section>}

    <section className="panel">
      <div className="panel-heading">
        <div><h2>{selectedClass ? selectedClass.name + (selectedClass.section ? ' — ' + selectedClass.section : '') : 'Class register'}</h2><p>{attendanceDate} · {classStudents.length} active students</p></div>
        <button type="button" className="secondary-button" onClick={() => window.print()} disabled={!classStudents.length}><Printer size={15}/> Print register</button>
      </div>
      {loading ? <p className="form-hint">Loading attendance register...</p> : !classId ? <p className="form-hint">Choose a class to begin.</p> : !classStudents.length ? <p className="form-hint">No active students are registered in this class.</p> : <>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Student</th><th>Admission number</th><th>Attendance status</th></tr></thead>
            <tbody>{classStudents.map((student, index) => <tr key={student.id}>
              <td>{index + 1}</td>
              <td>{student.first_name} {student.last_name}</td>
              <td>{student.admission_number}</td>
              <td><select aria-label={`Attendance for ${student.first_name} ${student.last_name}`} value={statuses[student.id] || 'Present'} onChange={event => setStatuses(current => ({ ...current, [student.id]: event.target.value }))}>
                <option>Present</option><option>Absent</option><option>Late</option><option>Excused</option>
              </select></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="form-actions"><button className="primary-button" type="button" onClick={() => void saveRegister()} disabled={saving || loading}><Save size={15}/>{saving ? 'Saving register...' : 'Save class attendance'}</button></div>
      </>}
    </section>
  </div>
}
