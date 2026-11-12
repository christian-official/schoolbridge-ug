import { useState } from 'react'

type ChildDetails = { first_name: string; last_name: string; admission_number: string; date_of_birth: string; class_name: string }
type ClaimStatus = 'pending_review' | 'verification_pending' | 'verified' | 'approved' | 'rejected' | 'expired' | 'completed'

export default function RegistrationFlow({ schoolId, schoolName, onBack }: { schoolId: string; schoolName: string; onBack: () => void }) {
  const [kind, setKind] = useState<'parent' | 'teacher'>('parent')
  const [stage, setStage] = useState<'details' | 'claim' | 'account' | 'done'>('details')
  const [parentName, setParentName] = useState('')
  const [relationship, setRelationship] = useState('')
  const [children, setChildren] = useState<ChildDetails[]>([{ first_name: '', last_name: '', admission_number: '', date_of_birth: '', class_name: '' }])
  const [teacher, setTeacher] = useState({ first_name: '', last_name: '', staff_number: '', position: '', department: '' })
  const [reference, setReference] = useState('')
  const [status, setStatus] = useState<ClaimStatus | ''>('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function request(path: string, body?: unknown) {
    const response = await fetch('/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.detail || 'Registration request failed.')
    return result
  }

  async function submitDetails(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const payload = kind === 'parent'
        ? { school_id: schoolId, parent_name: parentName.trim(), relationship: relationship.trim() || null,
            children: children.map(child => ({ first_name: child.first_name.trim(), last_name: child.last_name.trim(),
              admission_number: child.admission_number.trim() || null, date_of_birth: child.date_of_birth || null,
              class_name: child.class_name.trim() || null })) }
        : { school_id: schoolId, ...teacher, first_name: teacher.first_name.trim(), last_name: teacher.last_name.trim(),
            staff_number: teacher.staff_number.trim() || null, position: teacher.position.trim() || null,
            department: teacher.department.trim() || null }
      const result = await request('public/registration/' + kind, payload)
      setReference(result.claim_reference)
      setStatus(result.status)
      setMaskedPhone(result.phone_masked || '')
      setMessage(result.message || 'Your request was received.')
      setStage('claim')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to submit registration.') }
    finally { setBusy(false) }
  }

  async function refreshClaim() {
    if (!reference) return
    setBusy(true); setError('')
    try {
      const result = await request('public/registration/claims/' + encodeURIComponent(reference) + '?school_id=' + encodeURIComponent(schoolId))
      setStatus(result.status)
      if (result.status === 'verified' || result.status === 'approved') setStage('account')
      else if (result.status === 'rejected' || result.status === 'expired') setMessage('This request is ' + result.status + '. Please contact your school.')
      else setMessage(result.status === 'pending_review' ? 'Your school must review this request before account setup.' : 'Your request is still being processed.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to check registration status.') }
    finally { setBusy(false) }
  }

  async function verifyPhone(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request('public/registration/claims/' + encodeURIComponent(reference) + '/verify', { school_id: schoolId, code })
      setStatus(result.status); setMessage(result.message || 'Phone access verified.'); setCode(''); setStage('account')
    } catch (e) { setError(e instanceof Error ? e.message : 'Phone verification failed.') }
    finally { setBusy(false) }
  }

  async function completeAccount(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('')
    if (password !== confirmPassword) { setError('The passwords do not match.'); return }
    setBusy(true)
    try {
      const result = await request('public/registration/claims/' + encodeURIComponent(reference) + '/complete', { school_id: schoolId, username: username.trim(), password })
      setMessage(result.message || 'Your account has been created. You can now sign in.')
      setPassword(''); setConfirmPassword(''); setStage('done')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create your account.') }
    finally { setBusy(false) }
  }

  function updateChild(index: number, field: keyof ChildDetails, value: string) {
    setChildren(current => current.map((child, i) => i === index ? { ...child, [field]: value } : child))
  }

  return <main className="login-page"><section className="login-card registration-card">
    <div className="brand-name">School<span>Bridge</span></div>
    <h1>{stage === 'done' ? 'Registration complete' : 'Create your account'}</h1>
    <p className="muted">School: <strong>{schoolName}</strong></p>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="form-hint" role="status">{message}</p>}
    {stage === 'details' && <>
      <div className="registration-kind">
        <button type="button" className={kind === 'parent' ? 'primary-button' : 'secondary-button'} onClick={() => setKind('parent')}>Parent</button>
        <button type="button" className={kind === 'teacher' ? 'primary-button' : 'secondary-button'} onClick={() => setKind('teacher')}>Teacher</button>
      </div>
      <p className="form-hint">Your details are checked only against this school's records. Do not enter a phone number for verification.</p>
      <form onSubmit={submitDetails}>
        {kind === 'parent' ? <>
          <label htmlFor="reg-parent-name">Your full name</label><input id="reg-parent-name" value={parentName} onChange={e => setParentName(e.target.value)} required minLength={2} maxLength={160} autoComplete="name"/>
          <label htmlFor="reg-relationship">Relationship to child(ren)</label><input id="reg-relationship" value={relationship} onChange={e => setRelationship(e.target.value)} maxLength={60} placeholder="e.g. Mother, Father, Guardian"/>
          {children.map((child, index) => <fieldset className="registration-child" key={index}>
            <legend>Child {index + 1}</legend>
            <label>First name<input value={child.first_name} onChange={e => updateChild(index, 'first_name', e.target.value)} required maxLength={80}/></label>
            <label>Last name<input value={child.last_name} onChange={e => updateChild(index, 'last_name', e.target.value)} required maxLength={80}/></label>
            <label>Admission number (optional)<input value={child.admission_number} onChange={e => updateChild(index, 'admission_number', e.target.value)} maxLength={40}/></label>
            <label>Date of birth (optional)<input type="date" value={child.date_of_birth} onChange={e => updateChild(index, 'date_of_birth', e.target.value)}/></label>
            <label>Class (optional)<input value={child.class_name} onChange={e => updateChild(index, 'class_name', e.target.value)} maxLength={80}/></label>
            {children.length > 1 && <button type="button" className="recovery-link" onClick={() => setChildren(current => current.filter((_, i) => i !== index))}>Remove child</button>}
          </fieldset>)}
          {children.length < 10 && <button type="button" className="secondary-button" onClick={() => setChildren(current => [...current, { first_name: '', last_name: '', admission_number: '', date_of_birth: '', class_name: '' }])}>Add another child</button>}
        </> : <>
          <label htmlFor="reg-teacher-first">First name</label><input id="reg-teacher-first" value={teacher.first_name} onChange={e => setTeacher({ ...teacher, first_name: e.target.value })} required maxLength={80}/>
          <label htmlFor="reg-teacher-last">Last name</label><input id="reg-teacher-last" value={teacher.last_name} onChange={e => setTeacher({ ...teacher, last_name: e.target.value })} required maxLength={80}/>
          <label htmlFor="reg-staff-number">Staff number (optional)</label><input id="reg-staff-number" value={teacher.staff_number} onChange={e => setTeacher({ ...teacher, staff_number: e.target.value })} maxLength={40}/>
          <label htmlFor="reg-position">Position (optional)</label><input id="reg-position" value={teacher.position} onChange={e => setTeacher({ ...teacher, position: e.target.value })} maxLength={100}/>
          <label htmlFor="reg-department">Department (optional)</label><input id="reg-department" value={teacher.department} onChange={e => setTeacher({ ...teacher, department: e.target.value })} maxLength={100}/>
        </>}
        <button className="primary-button login-button" disabled={busy}>{busy ? 'Submitting...' : 'Submit registration'}</button>
      </form>
    </>}
    {stage === 'claim' && <>
      {status === 'verification_pending' ? <>
        <h2>Verify your school-recorded phone</h2>
        <p className="form-hint">A one-time code was sent to {maskedPhone || 'the trusted phone number held by your school'}. You cannot replace this number here.</p>
        <form onSubmit={verifyPhone}>
          <label htmlFor="reg-code">Six-digit verification code</label><input id="reg-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} required/>
          <button className="primary-button login-button" disabled={busy || code.length !== 6}>{busy ? 'Verifying...' : 'Verify phone'}</button>
        </form>
      </> : <>
        <h2>{status === 'pending_review' ? 'Waiting for school review' : 'Registration status'}</h2>
        <p className="form-hint">{status === 'pending_review' ? 'Your details could not be safely verified automatically. The school must review your request before you can create an account.' : 'Check whether the school has completed its review.'}</p>
        <button type="button" className="secondary-button login-button" onClick={refreshClaim} disabled={busy}>{busy ? 'Checking...' : 'Check registration status'}</button>
      </>}
    </>}
    {stage === 'account' && <>
      <p className="form-hint">Choose your own username and password. Your account will receive only the role and access approved by the school.</p>
      <form onSubmit={completeAccount}>
        <label htmlFor="reg-username">Choose username</label><input id="reg-username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={80} pattern="[A-Za-z0-9._-]+" autoComplete="username"/>
        <label htmlFor="reg-password">Create password</label><input id="reg-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password"/>
        <label htmlFor="reg-confirm-password">Confirm password</label><input id="reg-confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password"/>
        <button className="primary-button login-button" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
      </form>
    </>}
    {stage === 'done' && <p className="form-hint" role="status">{message}</p>}
    <button type="button" className="recovery-link" onClick={onBack}>{stage === 'done' ? 'Return to sign in' : 'Back to sign in'}</button>
  </section></main>
}
