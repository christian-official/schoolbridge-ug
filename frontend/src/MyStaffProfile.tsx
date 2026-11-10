import { useEffect, useState } from 'react'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
type AttendanceRecord = { id:number; attendance_date:string; status:string; notes?:string|null; check_in_at?:string|null; check_out_at?:string|null }
type ClassOption = { id:number; name:string; section?:string }
type SubjectOption = { id:number; name:string; school_type?:string }
type TeachingOptions = { classes:ClassOption[]; subjects:SubjectOption[]; class_subjects:{class_id:number;subject_ids:number[]}[]; class_teacher_class_ids:number[]; special_roles:string[] }
type Profile = {
  first_name: string; last_name: string; staff_number: string; position?: string | null; department?: string | null; subjects?: string | null; phone?: string | null;
  email?: string | null;
  category: string; username: string; photo_data?:string|null
}
async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
}
export default function MyStaffProfile({ token, onComplete }: { token: string; onComplete?: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [firstName, setFirstName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [photoData,setPhotoData]=useState<string|null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [attendanceBusy, setAttendanceBusy] = useState(false)
  const [attendanceMessage, setAttendanceMessage] = useState('')
  const [attendanceError, setAttendanceError] = useState('')
  const [saving, setSaving] = useState(false)
  const [teaching, setTeaching] = useState<TeachingOptions>({classes:[],subjects:[],class_subjects:[],class_teacher_class_ids:[],special_roles:[]})
  const [classSubjects, setClassSubjects] = useState<Record<number,number[]>>({})
  const [classTeacherIds, setClassTeacherIds] = useState<number[]>([])
  const [specialRoles, setSpecialRoles] = useState<string[]>([])
  const [assignmentsSaving, setAssignmentsSaving] = useState(false)
  async function load() {
    setLoading(true); setError('')
    try {
      const [data, attendanceData] = await Promise.all([request<Profile>('me/staff-profile', token), request<{records:AttendanceRecord[]}>('me/staff-attendance', token)])
      setProfile(data); setFirstName(data.first_name); setPhone(data.phone || ''); setEmail(data.email || ''); setPhotoData(data.photo_data||null)
      setAttendance(attendanceData.records || [])
      if (data.category === 'Teaching') {
        const assignments = await request<TeachingOptions>('me/teaching-assignments', token)
        setTeaching(assignments)
        setClassSubjects(Object.fromEntries(assignments.class_subjects.map(row=>[row.class_id,row.subject_ids])))
        setClassTeacherIds(assignments.class_teacher_class_ids)
        setSpecialRoles(assignments.special_roles)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load your profile.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [token])
  async function recordAttendance(action: 'check-in' | 'check-out') {
    setAttendanceBusy(true); setAttendanceError(''); setAttendanceMessage('')
    try {
      const result = await request<{message:string}>(`me/staff-attendance/${action}`, token, { method: 'POST' })
      setAttendanceMessage(result.message)
      const updated = await request<{records:AttendanceRecord[]}>('me/staff-attendance', token)
      setAttendance(updated.records || [])
    } catch (e) { setAttendanceError(e instanceof Error ? e.message : 'Unable to record attendance.') }
    finally { setAttendanceBusy(false) }
  }
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{message:string;profile:Profile}>('me/staff-profile', token, { method: 'PATCH', body: JSON.stringify({ first_name: firstName, phone, email, photo_data: photoData }) })
      setProfile(result.profile); setMessage(result.message); onComplete?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update your profile.') }
    finally { setSaving(false) }
  }
  async function saveTeachingAssignments() {
    setAssignmentsSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{message:string}>('me/teaching-assignments', token, { method:'PUT', body:JSON.stringify({
        class_subjects:Object.entries(classSubjects).map(([classId,subjectIds])=>({class_id:Number(classId),subject_ids:subjectIds})).filter(row=>row.subject_ids.length>0),
        class_teacher_class_ids:classTeacherIds,
        special_roles:specialRoles,
      })})
      setMessage(result.message)
      onComplete?.()
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to save your teaching assignments.') }
    finally { setAssignmentsSaving(false) }
  }
  async function savePassword(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    if (newPassword !== confirmPassword) { setError('The new passwords do not match.'); setSaving(false); return }
    try {
      const result = await request<{message:string}>('me/password', token, { method: 'PUT', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) })
      setMessage(result.message); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update your password.') }
    finally { setSaving(false) }
  }
  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>My staff profile</h2><p>Only your first name, phone number and email address can be edited. Your surname and staff number remain fixed.</p></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      {loading ? <p className="form-hint">Loading your profile…</p> : profile && <>
        <div className="student-profile-heading staff-profile-photo"><div className="student-avatar profile-avatar">{photoData?<img src={photoData} alt="Staff passport photo"/>:profile.first_name.slice(0,1).toUpperCase()}</div><div><strong>{profile.first_name} {profile.last_name}</strong><small>{profile.staff_number} · {profile.position||profile.category}</small></div></div>
        <section className="staff-self-checkin-card"><div><strong>Daily staff attendance</strong><span>Check in when you arrive and check out when you leave. Your shift status is updated here and your time is sent to the authorised attendance office.</span>{attendance[0] && <small>Today: {attendance[0].status} · In {attendance[0].check_in_at?.slice(11,16) || '—'} · Out {attendance[0].check_out_at?.slice(11,16) || '—'}</small>}</div><div className="form-actions"><button type="button" className="primary-button" disabled={attendanceBusy || !!attendance[0]?.check_in_at && attendance[0]?.attendance_date === new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Kampala'})} onClick={() => void recordAttendance('check-in')}>{attendanceBusy ? 'Sending…' : 'Check in'}</button><button type="button" className="secondary-button" disabled={attendanceBusy || !attendance[0]?.check_in_at || !!attendance[0]?.check_out_at || attendance[0]?.attendance_date !== new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Kampala'})} onClick={() => void recordAttendance('check-out')}>Check out</button></div></section>
        {attendanceError && <div className="form-error" role="alert">{attendanceError}</div>}{attendanceMessage && <div className="success-notice" role="status">{attendanceMessage}</div>}
        <section className="panel"><div className="panel-heading"><div><h3>My attendance history</h3><p>Your shift status and recorded check-in / check-out times.</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Check in</th><th>Check out</th><th>Status</th><th>Notes / shift</th></tr></thead><tbody>{attendance.map(row => <tr key={row.id}><td>{row.attendance_date}</td><td>{row.check_in_at?.slice(11,16) || '—'}</td><td>{row.check_out_at?.slice(11,16) || '—'}</td><td><span className={'attendance-status-pill status-' + row.status.toLowerCase()}>{row.status}</span></td><td><span className={'attendance-status-pill ' + (row.check_out_at ? 'status-present' : row.check_in_at ? 'status-late' : '')}>{row.check_out_at ? 'Shift ended' : row.check_in_at ? 'On shift' : 'Not checked in'}</span><small className="staff-shift-note">{row.check_out_at ? 'Checked out at ' + row.check_out_at.slice(11,16) : row.check_in_at ? 'Checked in at ' + row.check_in_at.slice(11,16) : 'No check-in recorded'}</small></td></tr>)}{!attendance.length && <tr><td colSpan={5}>No attendance records yet.</td></tr>}</tbody></table></div></section>
        <form className="student-form" onSubmit={saveProfile}>
          <div className="student-form-grid">
            <label className="field-span-full">Passport photo <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1200000){setError('Choose a passport photo no larger than 1.2 MB.');return}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Choose a JPG, PNG or WEBP image.');return}const reader=new FileReader();reader.onload=()=>setPhotoData(String(reader.result||''));reader.onerror=()=>setError('Unable to read the selected photo.');reader.readAsDataURL(file)}}/><small className="field-hint">Compulsory for every staff account. Upload a clear JPG, PNG or WEBP passport photo to complete your profile. Maximum 1.2 MB.</small>{photoData?<span className="photo-status">Passport photo added</span>:<span className="photo-status pending">Passport photo pending — required to complete the profile</span>}</label>
            <label>First name<input required value={firstName} onChange={e=>setFirstName(e.target.value)} /></label>
            <label>Surname (locked)<input value={profile.last_name} readOnly disabled /></label>
            <label>Staff number (locked)<input value={profile.staff_number} readOnly disabled /></label>
            <label>Login username<input value={profile.username} readOnly disabled /></label>
            <label>Phone number<input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} /></label>
            <label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></label>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={saving||!photoData}>{saving?'Saving...':photoData?'Save profile changes':'Add a passport photo to complete the profile'}</button></div>
        </form>
        {profile.category === 'Teaching' && <section className="student-form staff-assignment-onboarding">
          <div className="form-heading"><div><h3>My teaching assignments and school responsibilities</h3><p>Select the classes and subjects you teach. You may also declare class teacher, house, club, sports or duty responsibilities. These declarations do not grant administrator or system permissions.</p></div></div>
          <div className="staff-assignment-list">{teaching.classes.map(item=><div className="staff-assignment-class" key={item.id}>
            <div className="staff-assignment-class-heading"><strong>{item.name}{item.section?' — '+item.section:''}</strong><label><input type="checkbox" checked={classTeacherIds.includes(item.id)} onChange={e=>setClassTeacherIds(current=>e.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/> Class teacher</label></div>
            <div className="staff-assignment-subjects">{teaching.subjects.map(subject=><label key={subject.id}><input type="checkbox" checked={(classSubjects[item.id]||[]).includes(subject.id)} onChange={e=>setClassSubjects(current=>({...current,[item.id]:e.target.checked?[...(current[item.id]||[]),subject.id]:(current[item.id]||[]).filter(id=>id!==subject.id)}))}/>{subject.name}</label>)}</div>
          </div>)}</div>
          <div className="staff-special-roles"><strong>Additional responsibilities</strong><div>{['House Patron','Club Patron','Sports Coach','Duty Teacher'].map(role=><label key={role}><input type="checkbox" checked={specialRoles.includes(role)} onChange={e=>setSpecialRoles(current=>e.target.checked?[...current,role]:current.filter(value=>value!==role))}/>{role}</label>)}</div></div>
          <div className="form-actions"><button type="button" className="primary-button" disabled={assignmentsSaving} onClick={()=>void saveTeachingAssignments()}>{assignmentsSaving?'Saving assignments…':'Save my assignments'}</button></div>
        </section>}
        <hr />
        <form className="student-form" onSubmit={savePassword}>
          <div className="form-heading"><div><h3>Change password</h3><p>Use at least 8 characters. Your current password is required.</p></div></div>
          <div className="student-form-grid">
            <label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} /></label>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} /></label>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={saving}>Update password</button></div>
        </form>
      </>}
    </section>
  </div>
}
