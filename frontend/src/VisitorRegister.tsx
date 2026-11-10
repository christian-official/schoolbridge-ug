import { useEffect, useState } from 'react'

type Visitor = {
  id: number
  visitor_name: string
  phone?: string | null
  organisation?: string | null
  person_to_see: string
  purpose: string
  vehicle_registration?: string | null
  checked_in_at: string
  checked_out_at?: string | null
}

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

export default function VisitorRegister({ token, isAdmin = false }: { token: string; isAdmin?: boolean }) {
  const [rows, setRows] = useState<Visitor[]>([])
  const [draft, setDraft] = useState({ visitor_name: '', phone: '', organisation: '', person_to_see: '', purpose: '', vehicle_registration: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try { setRows(await request<Visitor[]>('visitors', token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load visitor register.') }
  }
  useEffect(() => { void load() }, [token])

  async function checkIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      await request('visitors/check-in', token, { method: 'POST', body: JSON.stringify(draft) })
      setDraft({ visitor_name: '', phone: '', organisation: '', person_to_see: '', purpose: '', vehicle_registration: '' })
      setMessage('Visitor checked in successfully.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to check visitor in.') }
    finally { setBusy(false) }
  }

  async function checkOut(id: number) {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await request<{message:string}>(`visitors/${id}/check-out`, token, { method: 'POST' })
      setMessage(result.message)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to check visitor out.') }
    finally { setBusy(false) }
  }

  return <div className="academic-workspace"><section className="panel">
    <div className="panel-heading"><div><h2>{isAdmin ? 'Visitors administration' : 'Visitor check-in'}</h2><p>{isAdmin ? 'Visitor records, including completed visits, are available to authorised administrators.' : 'Register visitors on arrival. After checkout, the record is transferred to administration and removed from your view.'}</p></div><button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="success-notice" role="status">{message}</div>}
    {!isAdmin && <form className="student-form" onSubmit={checkIn}><div className="form-heading"><div><h3>New visitor</h3><p>Record the visitor before allowing entry.</p></div></div>
      <div className="student-form-grid">
        <label>Visitor full name *<input required minLength={2} value={draft.visitor_name} onChange={e=>setDraft({...draft,visitor_name:e.target.value})}/></label>
        <label>Phone number<input value={draft.phone} onChange={e=>setDraft({...draft,phone:e.target.value})}/></label>
        <label>Organisation<input value={draft.organisation} onChange={e=>setDraft({...draft,organisation:e.target.value})}/></label>
        <label>Person to see *<input required value={draft.person_to_see} onChange={e=>setDraft({...draft,person_to_see:e.target.value})}/></label>
        <label>Purpose of visit *<input required value={draft.purpose} onChange={e=>setDraft({...draft,purpose:e.target.value})}/></label>
        <label>Vehicle registration<input value={draft.vehicle_registration} onChange={e=>setDraft({...draft,vehicle_registration:e.target.value})}/></label>
      </div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Check in visitor'}</button></div>
    </form>}
    <div className="table-wrap"><table><thead><tr><th>Visitor</th><th>Phone</th><th>Person to see</th><th>Purpose</th><th>Check in</th>{isAdmin && <th>Check out</th>}{!isAdmin && <th>Action</th>}</tr></thead><tbody>
      {rows.map(row=><tr key={row.id}><td><strong>{row.visitor_name}</strong>{row.organisation && <small>{row.organisation}</small>}</td><td>{row.phone || '—'}</td><td>{row.person_to_see}</td><td>{row.purpose}</td><td>{new Date(row.checked_in_at).toLocaleString()}</td>{isAdmin ? <td>{row.checked_out_at ? new Date(row.checked_out_at).toLocaleString() : 'Still on site'}</td> : <td><button type="button" className="primary-button" disabled={busy} onClick={()=>void checkOut(row.id)}>Check out</button></td>}</tr>)}
      {!rows.length && <tr><td colSpan={isAdmin ? 6 : 6}>No visitor records to display.</td></tr>}
    </tbody></table></div>
  </section></div>
}
