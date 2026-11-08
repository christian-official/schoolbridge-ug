import { useEffect, useState } from 'react'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
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
  const [position, setPosition] = useState('')
  const [department, setDepartment] = useState('')
  const [subjects, setSubjects] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  async function load() {
    setLoading(true); setError('')
    try {
      const data = await request<Profile>('me/staff-profile', token)
      setProfile(data); setFirstName(data.first_name); setPosition(data.position || ''); setDepartment(data.department || ''); setSubjects(data.subjects || ''); setPhone(data.phone || ''); setEmail(data.email || '')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load your profile.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [token])
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{message:string;profile:Profile}>('me/staff-profile', token, { method: 'PATCH', body: JSON.stringify({ first_name: firstName, position, department, subjects, phone, email }) })
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
      <div className="panel-heading"><div><h2>My staff profile</h2><p>Update your contact details and keep your sign-in password secure.</p></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      {loading ? <p className="form-hint">Loading your profile…</p> : profile && <>
        <form className="student-form" onSubmit={saveProfile}>
          <div className="student-form-grid">
            <label>First name<input required value={firstName} onChange={e=>setFirstName(e.target.value)} /></label>
            <label>Surname (locked)<input value={profile.last_name} readOnly disabled /></label>
            <label>Staff number (locked)<input value={profile.staff_number} readOnly disabled /></label>
            <label>Login username<input value={profile.username} readOnly disabled /></label>
            <label>Position<input value={position} onChange={e=>setPosition(e.target.value)} maxLength={100} /></label>
            <label>Department<input value={department} onChange={e=>setDepartment(e.target.value)} maxLength={100} /></label>
            <label>Subjects taught<input value={subjects} onChange={e=>setSubjects(e.target.value)} maxLength={500} /></label>
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
