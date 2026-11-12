import { fetchSchoolBridge } from './offlineNetwork'
import { useState } from 'react'

type ChildDetails = {
  first_name: string
  last_name: string
  admission_number: string
  date_of_birth: string
  class_name: string
}

export default function RegistrationFlow({
  schoolId,
  schoolName,
  apiBaseUrl,
  onAuthenticated,
}: {
  schoolId: string
  schoolName: string
  apiBaseUrl: string
  onAuthenticated: (token: string) => Promise<void> | void
}) {
  const [kind, setKind] = useState<'parent' | 'teacher'>('parent')
  const [formOpen, setFormOpen] = useState(false)
  const [parentName, setParentName] = useState('')
  const [relationship, setRelationship] = useState('')
  const [children, setChildren] = useState<ChildDetails[]>([
    { first_name: '', last_name: '', admission_number: '', date_of_birth: '', class_name: '' },
  ])
  const [teacher, setTeacher] = useState({
    first_name: '',
    last_name: '',
    staff_number: '',
    position: '',
    department: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submitDetails(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const payload = kind === 'parent'
        ? {
            school_id: schoolId,
            parent_name: parentName.trim(),
            relationship: relationship.trim() || null,
            children: children.map(child => ({
              first_name: child.first_name.trim(),
              last_name: child.last_name.trim(),
              admission_number: child.admission_number.trim() || null,
              date_of_birth: child.date_of_birth || null,
              class_name: child.class_name.trim() || null,
            })),
          }
        : {
            school_id: schoolId,
            first_name: teacher.first_name.trim(),
            last_name: teacher.last_name.trim(),
            staff_number: teacher.staff_number.trim(),
            position: teacher.position.trim() || null,
            department: teacher.department.trim() || null,
          }

      const response = await fetchSchoolBridge(
        apiBaseUrl + (kind === 'parent'
          ? '/api/public/registration/parent'
          : '/api/public/registration/teacher'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        },
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.detail || 'Your details could not be verified.')
      if (!result.access_token) throw new Error('Verification succeeded but a secure dashboard session was not issued.')

      setMessage(result.message || 'Your details were verified. Opening your dashboard.')
      await onAuthenticated(result.access_token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete registration.')
    } finally {
      setBusy(false)
    }
  }

  function updateChild(index: number, field: keyof ChildDetails, value: string) {
    setChildren(current => current.map((child, i) => i === index ? { ...child, [field]: value } : child))
  }

  return <main className="login-page registration-page">
    <section className="login-card registration-card">
      <div className="brand-name">School<span>Bridge</span></div>
      <h1>Join your school</h1>
      <p className="muted">School: <strong>{schoolName}</strong></p>
      <p className="form-hint">
        Enter the details already held in this school's records. SchoolBridge verifies them automatically and opens the correct dashboard. No password, phone code or administrator approval is required.
      </p>
      <div className="registration-kind">
        <button type="button" className="primary-button" onClick={() => { setKind('parent'); setError(''); setMessage(''); setFormOpen(true) }}>Parent</button>
        <button type="button" className="primary-button" onClick={() => { setKind('teacher'); setError(''); setMessage(''); setFormOpen(true) }}>Teacher</button>
      </div>

      {formOpen && <div className="registration-modal-backdrop" role="presentation">
        <section className="registration-modal" role="dialog" aria-modal="true" aria-labelledby="registration-modal-title">
          <header className="registration-modal-header">
            <div>
              <h2 id="registration-modal-title">{kind === 'parent' ? 'Parent details' : 'Teacher details'}</h2>
              <p>Enter the details already held in the school's records.</p>
            </div>
            <button type="button" className="registration-modal-close" aria-label="Close form" onClick={() => setFormOpen(false)}>×</button>
          </header>
          {error && <p className="error" role="alert">{error}</p>}
          {message && <p className="form-hint" role="status">{message}</p>}
          <form onSubmit={submitDetails}>
        {kind === 'parent' ? <>
          <label htmlFor="reg-parent-name">Your full name as recorded by the school</label>
          <input id="reg-parent-name" value={parentName} onChange={e => setParentName(e.target.value)} required minLength={2} maxLength={160} autoComplete="name"/>

          <label htmlFor="reg-relationship">Relationship to the child(ren)</label>
          <input id="reg-relationship" value={relationship} onChange={e => setRelationship(e.target.value)} required minLength={2} maxLength={60} placeholder="e.g. Mother, Father, Guardian"/>

          {children.map((child, index) => <fieldset className="registration-child" key={index}>
            <legend>Child {index + 1}</legend>
            <label>First name<input value={child.first_name} onChange={e => updateChild(index, 'first_name', e.target.value)} required maxLength={80}/></label>
            <label>Last name<input value={child.last_name} onChange={e => updateChild(index, 'last_name', e.target.value)} required maxLength={80}/></label>
            <label>Admission number<input value={child.admission_number} onChange={e => updateChild(index, 'admission_number', e.target.value)} required={!child.date_of_birth} maxLength={40} placeholder="Enter admission number or date of birth"/></label>
            <label>Date of birth<input type="date" value={child.date_of_birth} onChange={e => updateChild(index, 'date_of_birth', e.target.value)} required={!child.admission_number}/></label>
            <label>Class (optional)<input value={child.class_name} onChange={e => updateChild(index, 'class_name', e.target.value)} maxLength={80}/></label>
            {children.length > 1 && <button type="button" className="recovery-link" onClick={() => setChildren(current => current.filter((_, i) => i !== index))}>Remove child</button>}
          </fieldset>)}
          {children.length < 10 && <button type="button" className="secondary-button" onClick={() => setChildren(current => [...current, { first_name: '', last_name: '', admission_number: '', date_of_birth: '', class_name: '' }])}>Add another child</button>}
        </> : <>
          <label htmlFor="reg-teacher-first">First name as recorded by the school</label>
          <input id="reg-teacher-first" value={teacher.first_name} onChange={e => setTeacher({ ...teacher, first_name: e.target.value })} required maxLength={80}/>
          <label htmlFor="reg-teacher-last">Last name as recorded by the school</label>
          <input id="reg-teacher-last" value={teacher.last_name} onChange={e => setTeacher({ ...teacher, last_name: e.target.value })} required maxLength={80}/>
          <label htmlFor="reg-staff-number">Staff number</label>
          <input id="reg-staff-number" value={teacher.staff_number} onChange={e => setTeacher({ ...teacher, staff_number: e.target.value })} required maxLength={40}/>
          <label htmlFor="reg-position">Position (optional)</label>
          <input id="reg-position" value={teacher.position} onChange={e => setTeacher({ ...teacher, position: e.target.value })} maxLength={100}/>
          <label htmlFor="reg-department">Department (optional)</label>
          <input id="reg-department" value={teacher.department} onChange={e => setTeacher({ ...teacher, department: e.target.value })} maxLength={100}/>
        </>}

            <button className="primary-button login-button" disabled={busy}>
              {busy ? 'Verifying your details…' : 'Verify and open my dashboard'}
            </button>
          </form>
        </section>
      </div>}
    </section>
  </main>
}
