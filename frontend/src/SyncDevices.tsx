import { useCallback, useEffect, useState } from 'react'
import { clearLocalSyncData } from './syncStorage'

type Device = {
  device_id: string
  device_name: string
  created_at: string
  last_seen_at: string
  last_sync_sequence: number
  last_issued_sequence: number
  revoked_at: string | null
  active: boolean
}

type Proposal = {
  id: number
  device_id: string
  entity_type: string
  entity_id: number | null
  operation: string
  payload: Record<string, unknown>
  base_sequence: number
  status: string
  conflict_sequence: number | null
  submitted_at: string
  resolved_at: string | null
  resolution: string | null
}

type TeacherMarkProposal = { id:number; teacher_id:number; teacher_username:string; payload:{exam_id:number;subject_id:number;class_id:number;records:{student_id:number;score:number}[]}; status:string; conflict_sequence:number|null; submitted_at:string }\ntype Props = { token: string; userId: number; isAdmin: boolean }
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

function deviceStorageKey(userId: number) {
  return 'schoolbridge-sync-device-' + userId
}

function browserDeviceName() {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const platform = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : 'Device'
  return (browser + ' on ' + platform).slice(0, 100)
}

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(API_BASE_URL + '/api/' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || 'Request failed: ' + response.status)
  return result as T
}

export default function SyncDevices({ token, userId, isAdmin }: Props) {
  const [devices, setDevices] = useState<Device[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])\n  const [teacherMarkProposals, setTeacherMarkProposals] = useState<TeacherMarkProposal[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const storedId = localStorage.getItem(deviceStorageKey(userId)) || ''
      setDeviceId(storedId)
      const result = await request<{ devices: Device[] }>('sync/devices', token)
      setDevices(result.devices)
      if (isAdmin) {
        const teacherQueue = await request<{proposals:TeacherMarkProposal[]}>('sync/teacher-mark-proposals', token)
        setTeacherMarkProposals(teacherQueue.proposals)
      } else {
        setTeacherMarkProposals([])
      }
      const revokedCurrent = result.devices.some(device => device.device_id === storedId && !device.active)
      if (storedId && revokedCurrent) await clearLocalSyncData(userId, storedId)
      const activeCurrent = result.devices.some(device => device.device_id === storedId && device.active)
      if (isAdmin && storedId && activeCurrent) {
        const proposalResult = await request<{ proposals: Proposal[] }>('sync/proposals?device_id=' + encodeURIComponent(storedId), token)
        setProposals(proposalResult.proposals)
      } else {
        setProposals([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load registered devices.')
    } finally {
      setLoading(false)
    }
  }, [token, userId, isAdmin])

  useEffect(() => { void load() }, [load])

  async function register(replaceIdentity = false) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      let id = replaceIdentity ? crypto.randomUUID() : deviceId
      if (!id) id = crypto.randomUUID()
      await request<Device>('sync/devices', token, {
        method: 'POST',
        body: JSON.stringify({ device_id: id, device_name: browserDeviceName() }),
      })
      localStorage.setItem(deviceStorageKey(userId), id)
      setDeviceId(id)
      setMessage(replaceIdentity ? 'A new device identity has been registered.' : 'This browser is now registered for synchronisation.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register this device.')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this device? It will no longer be allowed to synchronise school data.')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request<{ message: string }>('sync/devices/' + id, token, { method: 'DELETE' })
      setMessage('Device access revoked. The device must reconnect and revalidate before any future synchronisation.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke this device.')
    } finally {
      setBusy(false)
    }
  }

  async function resolveProposal(id: number, decision: 'discard' | 'rebase') {
    const action = decision === 'discard' ? 'Discard this proposal?' : 'Rebase this proposal for fresh review? It will not be applied to live records.'
    if (!window.confirm(action)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request('sync/proposals/' + id + '/resolution', token, {
        method: 'PATCH',
        body: JSON.stringify({ device_id: deviceId, decision }),
      })
      setMessage(decision === 'discard' ? 'Proposal discarded.' : 'Proposal rebased and returned to pending review. No live record was changed.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve this proposal.')
    } finally {
      setBusy(false)
    }
  }

  async function approveTeacherMarkProposal(id:number) {
    if (!window.confirm('Approve and apply these offline marks to official examination records?')) return
    setBusy(true);setError('');setMessage('')
    try {
      const result=await request<{saved:number}>('sync/teacher-mark-proposals/'+id+'/apply',token,{method:'POST'})
      setMessage('Offline marks proposal #'+id+' approved. '+result.saved+' mark records were applied and remain unverified for academic verification.')
      await load()
    } catch(err) { setError(err instanceof Error?err.message:'Unable to approve offline marks.') }
    finally { setBusy(false) }
  }

  const currentDevice = devices.find(device => device.device_id === deviceId)
  const currentRevoked = Boolean(currentDevice && !currentDevice.active)

  return <section className="panel settings-panel sync-devices-panel">
    <div className="panel-heading"><div><h2>Registered devices</h2><p>Review the browsers and computers authorised to synchronise data for this account.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || busy}>Refresh</button></div>
    <div className="form-hint">Registration records device identity only. SchoolBridge does not currently store offline copies of school records in this browser.</div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="success-notice" role="status">{message}</div>}
    {loading ? <p className="form-hint">Loading registered devices…</p> : <>
      <div className="device-current-status">
        <strong>This browser</strong>
        <span>{!deviceId ? 'Not registered' : currentRevoked ? 'Access revoked' : currentDevice?.active ? 'Registered and active' : 'Identity not registered on the server'}</span>
        {!deviceId && <button className="primary-button" type="button" disabled={busy} onClick={() => void register()}>Register this browser</button>}
        {currentRevoked && <button className="primary-button" type="button" disabled={busy} onClick={() => void register(true)}>Register with a new device identity</button>}
        {deviceId && !currentRevoked && !currentDevice && <button className="primary-button" type="button" disabled={busy} onClick={() => void register()}>Register this browser</button>}
      </div>
      {isAdmin && currentDevice?.active && <>
        <h3>Offline change proposals</h3>
        <p className="form-hint">These are administrator-submitted drafts. Rebase only refreshes the review baseline; neither action applies a proposal to live school records.</p>
        {proposals.length === 0 ? <p className="empty-state">No offline proposals are waiting in this account's review list.</p> : <div className="table-wrap"><table><thead><tr><th>Proposal</th><th>Record</th><th>Status</th><th>Submitted</th><th>Review</th></tr></thead><tbody>
          {proposals.map(proposal => <tr key={proposal.id}>
            <td>#{proposal.id}<small className="form-hint">{proposal.operation}</small></td>
            <td>{proposal.entity_type}{proposal.entity_id ? ' #' + proposal.entity_id : ' (new record)'}<details className="sync-proposal-details"><summary>View submitted draft</summary><pre className="sync-proposal-payload">{JSON.stringify(proposal.payload, null, 2)}</pre></details></td>
            <td>{proposal.status}{proposal.conflict_sequence ? <small className="form-hint">Conflict at sequence {proposal.conflict_sequence}</small> : null}</td>
            <td>{proposal.submitted_at ? new Date(proposal.submitted_at + (proposal.submitted_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}</td>
            <td>{['pending_review', 'conflict'].includes(proposal.status) ? <div className="proposal-review-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void resolveProposal(proposal.id, 'rebase')}>Rebase</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void resolveProposal(proposal.id, 'discard')}>Discard</button></div> : proposal.resolution || 'Reviewed'}</td>
          </tr>)}
        </tbody></table></div>}
      </>}
      {isAdmin && <>
        <h3>Teacher offline marks awaiting review</h3>
        <p className="form-hint">Review the teacher, examination, subject and submitted scores. Approval rechecks the teacher's current assignment and mark conflicts; applied scores remain unverified.</p>
        {teacherMarkProposals.filter(item=>['pending_review','conflict'].includes(item.status)).length===0 ? <p className="empty-state">No teacher offline marks are awaiting review.</p> : <div className="table-wrap"><table><thead><tr><th>Teacher</th><th>Exam / subject</th><th>Records</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {teacherMarkProposals.filter(item=>['pending_review','conflict'].includes(item.status)).map(item=><tr key={item.id}>
            <td>{item.teacher_username}<small className="form-hint">Proposal #{item.id}</small></td>
            <td>Exam #{item.payload.exam_id} · Subject #{item.payload.subject_id}<small className="form-hint">Class #{item.payload.class_id}</small></td>
            <td><details className="sync-proposal-details"><summary>{item.payload.records.length} score entries</summary><pre className="sync-proposal-payload">{JSON.stringify(item.payload.records,null,2)}</pre></details></td>
            <td>{item.status}{item.conflict_sequence ? <small className="form-hint">Changed after sequence {item.conflict_sequence}</small> : null}</td>
            <td><button className="primary-button" type="button" disabled={busy||item.status==='conflict'} onClick={()=>void approveTeacherMarkProposal(item.id)}>Approve & apply</button></td>
          </tr>)}
        </tbody></table></div>}
      </>}
      <h3>Devices linked to this account</h3>
      {devices.length === 0 ? <p className="empty-state">No devices have been registered yet.</p> : <div className="table-wrap"><table><thead><tr><th>Device</th><th>Status</th><th>Last seen</th><th>Sync checkpoint</th><th>Action</th></tr></thead><tbody>
        {devices.map(device => <tr key={device.device_id}>
          <td><strong>{device.device_name}</strong>{device.device_id === deviceId && <small className="form-hint">This browser</small>}</td>
          <td>{device.active ? 'Active' : 'Revoked'}</td>
          <td>{device.last_seen_at ? new Date(device.last_seen_at + (device.last_seen_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}</td>
          <td>{device.last_sync_sequence} / {device.last_issued_sequence}</td>
          <td>{device.active ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void revoke(device.device_id)}>Revoke</button> : '—'}</td>
        </tr>)}
      </tbody></table></div>}
    </>}
  </section>
}
