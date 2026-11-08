import { useEffect, useState } from 'react'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
type AttendanceRecord = { id:number; attendance_date:string; status:string; notes?:string|null; check_in_at?:string|null; check_out_at?:string|null }
type Profile = {
  first_name: string; last_name: string; staff_number: string; position?: string | null; department?: string | null; subjects?: string | null; phone?: string | null;
  email?: string | null;
  category: string; username: string
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
export default function MyStaffProfile({ token }: { token: string }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [firstName, setFirstName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
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
  async function load() {
    setLoading(true); setError('')
    try {
      const [data, attendanceData] = await Promise.all([request<Profile>('me/staff-profile', token), request<{records:AttendanceRecord[]}>('me/staff-attendance', token)])
      setProfile(data); setFirstName(data.first_name); setPhone(data.phone || ''); setEmail(data.email || '')
      setAttendance(attendanceData.records || [])
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
      const result = await request<{message:string;profile:Profile}>('me/staff-profile', token, { method: 'PATCH', body: JSON.stringify({ first_name: firstName, phone, email }) })
      setProfile(result.profile); setMessage(result.message)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update your profile.') }
    finally { setSaving(false) }
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
        <section className="staff-self-checkin-card"><div><strong>Daily staff attendance</strong><span>Check in when you arrive and check out when you leave. Your time is sent to the authorised attendance office.</span>{attendance[0] && <small>Today: {attendance[0].status} · In {attendance[0].check_in_at?.slice(11,16) || '—'} · Out {attendance[0].check_out_at?.slice(11,16) || '—'}</small>}</div><div className="form-actions"><button type="button" className="primary-button" disabled={attendanceBusy || !!attendance[0]?.check_in_at && attendance[0]?.attendance_date === new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Kampala'})} onClick={() => void recordAttendance('check-in')}>{attendanceBusy ? 'Sending…' : 'Check in'}</button><button type="button" className="secondary-button" disabled={attendanceBusy || !attendance[0]?.check_in_at || !!attendance[0]?.check_out_at || attendance[0]?.attendance_date !== new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Kampala'})} onClick={() => void recordAttendance('check-out')}>Check out</button></div></section>
        {attendanceError && <div className="form-error" role="alert">{attendanceError}</div>}{attendanceMessage && <div className="success-notice" role="status">{attendanceMessage}</div>}
        <section className="panel"><div className="panel-heading"><div><h3>My attendance history</h3><p>Stored daily check-in records and attendance decisions.</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Check in</th><th>Check out</th><th>Status</th></tr></thead><tbody>{attendance.map(row => <tr key={row.id}><td>{row.attendance_date}</td><td>{row.check_in_at?.slice(11,16) || '—'}</td><td>{row.check_out_at?.slice(11,16) || '—'}</td><td><span className={'attendance-status-pill status-' + row.status.toLowerCase()}>{row.status}</span></td></tr>)}{!attendance.length && <tr><td colSpan={4}>No attendance records yet.</td></tr>}</tbody></table></div></section>
        <form className="student-form" onSubmit={saveProfile}>
          <div className="student-form-grid">
            <label>First name<input required value={firstName} onChange={e=>setFirstName(e.target.value)} /></label>
            <label>Surname (locked)<input value={profile.last_name} readOnly disabled /></label>
            <label>Staff number (locked)<input value={profile.staff_number} readOnly disabled /></label>
            <label>Login username<input value={profile.username} readOnly disabled /></label>
            <label>Phone number<input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} /></label>
            <label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></label>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={saving}>Save profile changes</button></div>
        </form>
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
