import { useEffect, useMemo, useState } from 'react'
import { Printer, RefreshCw, Save, Download, Upload, LockKeyhole } from 'lucide-react'
import { saveEncryptedOfflineAttendanceDraft, loadEncryptedOfflineAttendanceDraft, deleteEncryptedOfflineAttendanceDraft } from './syncStorage'

type SchoolClass = { id: number; name: string; section?: string }
type Student = { id: number; first_name: string; last_name: string; admission_number: string; class_id: number | null; status?: string }
type Attendance = { id: number; student_id: number; attendance_date: string; status: string }
type Summary = { total_students: number; marked: number; unmarked: number; present: number; absent: number; late: number; excused: number; attendance_rate: number }

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
}

export default function AttendanceManagement({ token, userId, canEdit = true }: { token: string; userId:number; canEdit?: boolean }) {
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
  const [offlinePassphrase, setOfflinePassphrase] = useState('')
  const [offlineDraftMessage, setOfflineDraftMessage] = useState('')
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [attendanceBaseline, setAttendanceBaseline] = useState<{base_sequence:number;base_attendance_ids:Record<string,number|null>}|null>(null)

  async function load() {
    setLoading(true); setError('')
    try {
      const classRows = await request<SchoolClass[]>('attendance/options', token)
      setClasses(classRows)
      if (!classId && classRows.length) setClassId(String(classRows[0].id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load class registers.')
    } finally { setLoading(false) }
  }

  async function loadRegister(selectedClass = classId, selectedDate = attendanceDate) {
    if (!selectedClass) { setSummary(null); setStudents([]); return }
    setLoading(true); setError('')
    try {
      const [studentRows, rows, totals] = await Promise.all([
        request<Student[]>(`attendance/students?class_id=${selectedClass}`, token),
        request<Attendance[]>(`attendance?class_id=${selectedClass}&attendance_date=${selectedDate}`, token),
        request<Summary>(`attendance/summary?class_id=${selectedClass}&attendance_date=${selectedDate}`, token),
      ])
      setStudents(studentRows)
      setSummary(totals)
      const byStudent = Object.fromEntries(rows.map(row => [row.student_id, row.status]))
      const next: Record<number, string> = {}
      studentRows.forEach(student => { next[student.id] = byStudent[student.id] || '' })
      setStatuses(next)
      const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
      if(deviceId){
        try{
          const baseline=await request<{base_sequence:number;base_attendance_ids:Record<string,number|null>}>('sync/attendance-baseline?device_id='+encodeURIComponent(deviceId)+'&class_id='+selectedClass+'&attendance_date='+selectedDate,token)
          setAttendanceBaseline({base_sequence:baseline.base_sequence,base_attendance_ids:baseline.base_attendance_ids})
        }catch{setAttendanceBaseline(null)}
      }else setAttendanceBaseline(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load attendance register.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [token])
  useEffect(() => { if (classId) void loadRegister() }, [classId, attendanceDate])

  const classStudents = useMemo(() => students.filter(student => String(student.class_id) === classId).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)), [students, classId])

  async function saveRegister() {
    if (!classId || !classStudents.length) return
    if (classStudents.some(student => !statuses[student.id])) { setError('Select an attendance status for every student before saving the register.'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{ saved: number; message: string }>('attendance/register', token, {
        method: 'PUT',
        body: JSON.stringify({
          class_id: Number(classId),
          attendance_date: attendanceDate,
          records: classStudents.map(student => ({ student_id: student.id, status: statuses[student.id] })),
        }),
      })
      setMessage(`${result.saved} student attendance records saved for ${attendanceDate}.`)
      await loadRegister()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save the class register.')
    } finally { setSaving(false) }
  }


  async function saveOfflineAttendanceDraft(){
    if(!canEdit||!classId||!classStudents.length){setOfflineDraftMessage('Choose a class with active students first.');return}
    if(!offlinePassphrase||offlinePassphrase.length<12){setOfflineDraftMessage('Use a passphrase of at least 12 characters. It is never stored.');return}
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId){setOfflineDraftMessage('Register this browser under Device Management before saving offline attendance.');return}
    if(!attendanceBaseline){setOfflineDraftMessage('Load this class register while connected to obtain its secure attendance baseline.');return}
    if(classStudents.some(student=>!statuses[student.id])){setOfflineDraftMessage('Select an attendance status for every student before saving the offline register.');return}
    setOfflineBusy(true);setOfflineDraftMessage('')
    const draft={version:1,userId,deviceId,classId:Number(classId),attendanceDate,baseSequence:attendanceBaseline.base_sequence,
      baseAttendanceIds:attendanceBaseline.base_attendance_ids,students:classStudents,
      records:classStudents.map(student=>({student_id:student.id,status:statuses[student.id]})),
      idempotencyKey:crypto.randomUUID(),savedAt:Date.now()}
    try{
      try{await saveEncryptedOfflineAttendanceDraft(userId,deviceId,offlinePassphrase,draft,false)}
      catch(error){
        if(error instanceof Error&&error.message.includes('already exists')&&window.confirm('An offline attendance draft already exists. Replace it with this register?')){
          await saveEncryptedOfflineAttendanceDraft(userId,deviceId,offlinePassphrase,draft,true)
        }else throw error
      }
      setOfflineDraftMessage('Attendance register encrypted and saved on this device. It has not yet changed official attendance.')
    }catch(error){setOfflineDraftMessage(error instanceof Error?error.message:'Unable to save the encrypted attendance draft.')}
    finally{setOfflineBusy(false)}
  }

  async function unlockOfflineAttendanceDraft(){
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId){setOfflineDraftMessage('No registered device identity is saved on this browser.');return}
    if(offlinePassphrase.length<12){setOfflineDraftMessage('Enter the 12-character-or-longer offline passphrase.');return}
    setOfflineBusy(true);setOfflineDraftMessage('')
    try{
      const draft=await loadEncryptedOfflineAttendanceDraft<any>(userId,deviceId,offlinePassphrase)
      if(draft.version!==1||draft.userId!==userId||draft.deviceId!==deviceId)throw new Error('This attendance draft belongs to another account or device.')
      setClassId(String(draft.classId));setAttendanceDate(draft.attendanceDate)
      setStudents(draft.students||[])
      setStatuses(Object.fromEntries((draft.records||[]).map((row:any)=>[row.student_id,row.status])))
      setAttendanceBaseline({base_sequence:draft.baseSequence,base_attendance_ids:draft.baseAttendanceIds})
      setSummary(null);setError('')
      setOfflineDraftMessage('Encrypted attendance draft unlocked. Review it and submit when the server is reachable.')
    }catch(error){setOfflineDraftMessage(error instanceof Error?error.message:'Unable to unlock the attendance draft.')}
    finally{setOfflineBusy(false)}
  }

  async function submitOfflineAttendanceDraft(){
    const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)
    if(!deviceId){setOfflineDraftMessage('No registered device identity is saved on this browser.');return}
    if(offlinePassphrase.length<12){setOfflineDraftMessage('Enter the offline passphrase to unlock and submit the draft.');return}
    setOfflineBusy(true);setOfflineDraftMessage('')
    try{
      const draft=await loadEncryptedOfflineAttendanceDraft<any>(userId,deviceId,offlinePassphrase)
      if(draft.userId!==userId||draft.deviceId!==deviceId)throw new Error('This attendance draft belongs to another account or device.')
      const result=await request<{proposal_id:number;status:string;applied:boolean;saved:number}>('sync/attendance-batches',token,{
        method:'POST',body:JSON.stringify({device_id:deviceId,idempotency_key:draft.idempotencyKey,class_id:draft.classId,
          attendance_date:draft.attendanceDate,base_sequence:draft.baseSequence,base_attendance_ids:draft.baseAttendanceIds,records:draft.records})
      })
      if(result.applied){
        await deleteEncryptedOfflineAttendanceDraft(userId,deviceId)
        setOfflineDraftMessage(result.saved+' attendance records were automatically applied by the system.')
        if(String(draft.classId)===classId&&draft.attendanceDate===attendanceDate)await loadRegister(String(draft.classId),draft.attendanceDate)
      }else{
        setOfflineDraftMessage('Attendance draft #'+result.proposal_id+' was not applied because a conflict was detected. Refresh the register, review it and save a new draft.')
      }
    }catch(error){setOfflineDraftMessage(error instanceof Error?error.message:'Unable to submit offline attendance. The encrypted draft remains saved.')}
    finally{setOfflineBusy(false)}
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
              <td>{canEdit ? <div className="attendance-choice-group" role="group" aria-label={`Attendance for ${student.first_name} ${student.last_name}`}>
                {(['Present', 'Absent', 'Late', 'Excused'] as const).map(status => <button key={status} type="button" className={`attendance-choice attendance-${status.toLowerCase()} ${(statuses[student.id] === status) ? 'selected' : ''}`} aria-pressed={statuses[student.id] === status} onClick={() => setStatuses(current => ({ ...current, [student.id]: status }))}>{status}</button>)}
              </div> : <span className={`attendance-status-pill status-${(statuses[student.id] || 'unmarked').toLowerCase()}`}>{statuses[student.id] || 'Not marked'}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {canEdit && <div className="form-actions"><button className="primary-button" type="button" onClick={() => void saveRegister()} disabled={saving || loading}><Save size={15}/>{saving ? 'Saving register...' : 'Save class attendance'}</button></div>}
        {canEdit&&<div className="offline-attendance-tools">
          <h3>Offline attendance</h3>
          <p className="form-hint">Save this register in encrypted browser storage while disconnected. A valid submission is automatically applied after the server rechecks your device, class assignment, permissions, students and attendance baseline.</p>
          <input type="password" autoComplete="new-password" value={offlinePassphrase} onChange={event=>setOfflinePassphrase(event.target.value)} placeholder="Offline passphrase (12+ characters)" />
          <div className="form-actions">
            <button className="secondary-button" type="button" disabled={offlineBusy||saving} onClick={()=>void saveOfflineAttendanceDraft()}><LockKeyhole size={15}/> Save encrypted draft</button>
            <button className="secondary-button" type="button" disabled={offlineBusy} onClick={()=>void unlockOfflineAttendanceDraft()}><Download size={15}/> Unlock draft</button>
            <button className="primary-button" type="button" disabled={offlineBusy} onClick={()=>void submitOfflineAttendanceDraft()}><Upload size={15}/> Submit when connected</button>
          </div>
          {offlineDraftMessage&&<p className="form-hint" role="status">{offlineDraftMessage}</p>}
        </div>}
        {!canEdit && <p className="form-hint">View-only attendance access. You cannot change this register.</p>}
      </>}
    </section>
  </div>
}
