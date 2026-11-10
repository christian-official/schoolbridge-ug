import { useCallback, useEffect, useState } from 'react'
import { clearLocalSyncData, saveEncryptedOfflineSnapshot, loadEncryptedOfflineSnapshot, deleteEncryptedOfflineSnapshot } from './syncStorage'

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

type Props = { token: string; userId: number; isAdmin: boolean }
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
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [offlinePassphrase, setOfflinePassphrase] = useState('')
  const [offlineStatus, setOfflineStatus] = useState('')
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [offlineSnapshot, setOfflineSnapshot] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const storedId = localStorage.getItem(deviceStorageKey(userId)) || ''
      setDeviceId(storedId)
      const result = await request<{ devices: Device[] }>('sync/devices', token)
      setDevices(result.devices)
      const revokedCurrent = result.devices.some(device => device.device_id === storedId && !device.active)
      if (storedId && revokedCurrent) { await clearLocalSyncData(userId, storedId); localStorage.removeItem('schoolbridge-offline-snapshot-meta-' + userId + '-' + storedId); setOfflineSnapshot(null) }
      const activeCurrent = result.devices.some(device => device.device_id === storedId && device.active)
      if (storedId && activeCurrent) {
        const metaKey = 'schoolbridge-offline-snapshot-meta-' + userId + '-' + storedId
        const rawMeta = localStorage.getItem(metaKey)
        if (rawMeta) {
          try {
            const meta = JSON.parse(rawMeta) as { fingerprint:string; sequence:number }
            const account = await request<{role:string;permissions:Record<string,string[]>}>('auth/me', token)
            const fingerprint = JSON.stringify({role:account.role,permissions:Object.fromEntries(Object.entries(account.permissions||{}).sort(([a],[b])=>a.localeCompare(b)))})
            const changes = await request<{changes:unknown[];has_more:boolean}>('sync/changes?device_id='+encodeURIComponent(storedId)+'&cursor='+meta.sequence+'&limit=500', token)
            if (meta.fingerprint !== fingerprint || changes.changes.length > 0 || changes.has_more) {
              await deleteEncryptedOfflineSnapshot(userId, storedId)
              localStorage.removeItem(metaKey)
              setOfflineSnapshot(null)
              setOfflineStatus('The saved offline copy was cleared because permissions or school records changed. Download a fresh copy while connected.')
            }
          } catch {
            // Keep the encrypted copy when the server is unreachable; its short expiry still applies.
          }
        }
      }
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


  function permissionFingerprint(account:{role:string;permissions:Record<string,string[]>}) {
    return JSON.stringify({role:account.role,permissions:Object.fromEntries(Object.entries(account.permissions||{}).sort(([a],[b])=>a.localeCompare(b)))})
  }

  async function collectSnapshotPages<T>(endpoint:string, field:string, id:string, sequences:number[]):Promise<T[]> {
    const records:T[]=[]
    let after=0
    for(let page=0;page<100;page++){
      const result=await request<any>('sync/'+endpoint+'?device_id='+encodeURIComponent(id)+'&after_id='+after+'&limit=200',token)
      if(typeof result.snapshot_sequence==='number')sequences.push(result.snapshot_sequence)
      records.push(...(result[field] as T[]))
      if(records.length>15000)throw new Error('This record category exceeds the 15,000-record offline safety limit.')
      if(!result.has_more)return records
      after=result.next_after_id
    }
    throw new Error('This record category is too large to finish safely in one download.')
  }

  async function downloadOfflineRecords() {
    if(!deviceId||!currentDevice?.active){setOfflineStatus('Register this browser and confirm it is active before downloading records.');return}
    if(offlinePassphrase.length<12){setOfflineStatus('Use a passphrase of at least 12 characters. It is never stored.');return}
    setOfflineBusy(true);setOfflineStatus('')
    try{
      const account=await request<{role:string;permissions:Record<string,string[]>}>('auth/me',token)
      const permissions=account.permissions||{}
      const can=(section:string)=>account.role==='admin'||(permissions[section]||[]).includes('view')
      const parent=account.role==='parent', teacher=account.role==='teacher'
      const sequences:number[]=[]
      const snapshot:any={version:1,userId,deviceId,permissionFingerprint:permissionFingerprint(account),downloadedAt:Date.now(),expiresAt:Date.now()+24*60*60*1000,sequence:0,students:[],classes:[],attendance:[],exams:[],marks:[],charges:[],payments:[],class_fees:[]}
      const tasks:Promise<void>[]=[]
      if(parent||can('Students')||(teacher&&can('My Classes'))){
        tasks.push(collectSnapshotPages<any>('students','students',deviceId,sequences).then(rows=>{snapshot.students=rows}))
        tasks.push(collectSnapshotPages<any>('classes','classes',deviceId,sequences).then(rows=>{snapshot.classes=rows}))
      }
      if(parent||can('Attendance')||(teacher&&(can('My Attendance')||can('Attendance')))){
        tasks.push(collectSnapshotPages<any>('attendance','attendance',deviceId,sequences).then(rows=>{snapshot.attendance=rows}))
      }
      if(parent||can('Examinations')||(teacher&&can('My Results'))){
        tasks.push(collectSnapshotPages<any>('exams','exams',deviceId,sequences).then(rows=>{snapshot.exams=rows}))
        if(teacher&&can('My Results')||!teacher&&(parent||can('Examinations'))){
          tasks.push(collectSnapshotPages<any>('marks','marks',deviceId,sequences).then(rows=>{snapshot.marks=rows}))
        }
      }
      if(parent||can('Fees & Finance')){
        let charge=0,payment=0,classFee=0
        for(let page=0;page<100;page++){
          const result=await request<any>('sync/fees?device_id='+encodeURIComponent(deviceId)+'&after_charge_id='+charge+'&after_payment_id='+payment+'&after_class_fee_id='+classFee+'&limit=200',token)
          if(typeof result.snapshot_sequence==='number')sequences.push(result.snapshot_sequence)
          snapshot.charges.push(...result.charges);snapshot.payments.push(...result.payments);snapshot.class_fees.push(...result.class_fees)
          if(Object.values(result.has_more||{}).some(Boolean)){
            charge=result.next_after_charge_id;payment=result.next_after_payment_id;classFee=result.next_after_class_fee_id
          }else break
          if(snapshot.charges.length+snapshot.payments.length+snapshot.class_fees.length>15000)throw new Error('The finance snapshot exceeds the 15,000-record safety limit.')
          if(page===99)throw new Error('The finance snapshot is too large to finish safely.')
        }
      }
      await Promise.all(tasks)
      if(!sequences.length||new Set(sequences).size!==1)throw new Error('School records changed while the snapshot was being downloaded. Retry to obtain a consistent copy.')
      const total=Object.keys(snapshot).filter(key=>Array.isArray(snapshot[key])).reduce((sum,key)=>sum+snapshot[key].length,0)
      if(total>20000)throw new Error('This account has more than 20,000 authorised records. Narrow the data scope before downloading.')
      snapshot.sequence=sequences[0]
      await saveEncryptedOfflineSnapshot(userId,deviceId,offlinePassphrase,snapshot)
      localStorage.setItem('schoolbridge-offline-snapshot-meta-'+userId+'-'+deviceId,JSON.stringify({fingerprint:snapshot.permissionFingerprint,sequence:snapshot.sequence}))
      setOfflineSnapshot(snapshot)
      setOfflineStatus('Authorised records were encrypted and saved on this browser. The copy expires in 24 hours and is cleared if changed permissions or records are detected after reconnecting.')
    }catch(error){setOfflineStatus(error instanceof Error?error.message:'Unable to create the encrypted offline snapshot.')}
    finally{setOfflineBusy(false)}
  }

  async function unlockOfflineRecords() {
    const id=localStorage.getItem(deviceStorageKey(userId))||deviceId
    if(!id){setOfflineStatus('This browser has no registered device identity.');return}
    if(offlinePassphrase.length<12){setOfflineStatus('Enter the 12-character-or-longer offline passphrase.');return}
    setOfflineBusy(true);setOfflineStatus('')
    try{
      const snapshot=await loadEncryptedOfflineSnapshot<any>(userId,id,offlinePassphrase)
      if(snapshot.version!==1||snapshot.userId!==userId||snapshot.deviceId!==id)throw new Error('This offline snapshot belongs to a different account or device.')
      if(!snapshot.expiresAt||snapshot.expiresAt<Date.now()){
        await deleteEncryptedOfflineSnapshot(userId,id)
        localStorage.removeItem('schoolbridge-offline-snapshot-meta-'+userId+'-'+id)
        throw new Error('The offline snapshot has expired. Reconnect and download a fresh copy.')
      }
      setOfflineSnapshot(snapshot)
      setOfflineStatus('Encrypted offline records unlocked. Last downloaded '+new Date(snapshot.downloadedAt).toLocaleString()+'.')
    }catch(error){setOfflineStatus(error instanceof Error?error.message:'Unable to unlock offline records.')}
    finally{setOfflineBusy(false)}
  }

  async function clearOfflineRecords() {
    const id=localStorage.getItem(deviceStorageKey(userId))||deviceId
    if(!id)return
    setOfflineBusy(true)
    try{
      await deleteEncryptedOfflineSnapshot(userId,id)
      localStorage.removeItem('schoolbridge-offline-snapshot-meta-'+userId+'-'+id)
      setOfflineSnapshot(null);setOfflineStatus('The encrypted offline record copy was cleared.')
    }catch(error){setOfflineStatus(error instanceof Error?error.message:'Unable to clear offline records.')}
    finally{setOfflineBusy(false)}
  }

  const currentDevice = devices.find(device => device.device_id === deviceId)
  const currentRevoked = Boolean(currentDevice && !currentDevice.active)

  return <section className="panel settings-panel sync-devices-panel">
    <div className="panel-heading"><div><h2>Registered devices</h2><p>Review the browsers and computers authorised to synchronise data for this account.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || busy}>Refresh</button></div>
    <div className="form-hint">Registered devices can keep a short-lived encrypted copy of records currently authorised for this account. The server remains authoritative.</div>
    <div className="offline-record-tools">
      <h3>Encrypted offline records</h3>
      <p className="form-hint">Use a private passphrase of at least 12 characters. It is never stored. The encrypted copy expires after 24 hours and is cleared when changed permissions or records are detected after reconnecting.</p>
      <input type="password" autoComplete="new-password" value={offlinePassphrase} onChange={event=>setOfflinePassphrase(event.target.value)} placeholder="Offline records passphrase (12+ characters)" />
      <div className="proposal-review-actions">
        <button className="primary-button" type="button" disabled={offlineBusy||loading||!currentDevice?.active} onClick={()=>void downloadOfflineRecords()}>{offlineBusy?'Working…':'Download authorised records'}</button>
        <button className="secondary-button" type="button" disabled={offlineBusy} onClick={()=>void unlockOfflineRecords()}>Unlock saved records</button>
        <button className="secondary-button" type="button" disabled={offlineBusy} onClick={()=>void clearOfflineRecords()}>Clear offline copy</button>
      </div>
      {offlineStatus&&<p className="form-hint" role="status">{offlineStatus}</p>}
      {offlineSnapshot&&<div className="sync-offline-snapshot">
        <strong>Offline copy unlocked</strong>
        <p className="form-hint">Expires {new Date(offlineSnapshot.expiresAt).toLocaleString()} · Journal sequence {offlineSnapshot.sequence}</p>
        <p>{offlineSnapshot.students?.length||0} students · {offlineSnapshot.classes?.length||0} classes · {offlineSnapshot.attendance?.length||0} attendance records · {offlineSnapshot.exams?.length||0} examinations · {offlineSnapshot.marks?.length||0} marks · {(offlineSnapshot.charges?.length||0)+(offlineSnapshot.payments?.length||0)+(offlineSnapshot.class_fees?.length||0)} finance records</p>
        {offlineSnapshot.students?.length>0&&<details><summary>View authorised student records</summary><div className="table-wrap"><table><thead><tr><th>Admission no.</th><th>Student</th><th>Class ID</th><th>Status</th></tr></thead><tbody>{offlineSnapshot.students.slice(0,200).map((student:any)=><tr key={student.id}><td>{student.admission_number}</td><td>{[student.first_name,student.middle_name,student.last_name].filter(Boolean).join(' ')}</td><td>{student.class_id??'—'}</td><td>{student.status}</td></tr>)}</tbody></table>{offlineSnapshot.students.length>200&&<p className="form-hint">Showing first 200 of {offlineSnapshot.students.length} students.</p>}</div></details>}
        {offlineSnapshot.classes?.length>0&&<details><summary>View authorised classes</summary><div className="table-wrap"><table><thead><tr><th>Class</th><th>Section</th></tr></thead><tbody>{offlineSnapshot.classes.slice(0,200).map((row:any)=><tr key={row.id}><td>{row.name}</td><td>{row.section||'—'}</td></tr>)}</tbody></table></div></details>}
        {offlineSnapshot.attendance?.length>0&&<details><summary>View attendance records</summary><div className="table-wrap"><table><thead><tr><th>Student ID</th><th>Date</th><th>Status</th></tr></thead><tbody>{offlineSnapshot.attendance.slice(0,200).map((row:any)=><tr key={row.id}><td>{row.student_id}</td><td>{String(row.attendance_date).slice(0,10)}</td><td>{row.status}</td></tr>)}</tbody></table></div></details>}
        {offlineSnapshot.exams?.length>0&&<details><summary>View examinations</summary><div className="table-wrap"><table><thead><tr><th>Examination</th><th>Term</th><th>Year</th><th>Class ID</th></tr></thead><tbody>{offlineSnapshot.exams.slice(0,200).map((row:any)=><tr key={row.id}><td>{row.name}</td><td>{row.term}</td><td>{row.year}</td><td>{row.class_id??'—'}</td></tr>)}</tbody></table></div></details>}
        {offlineSnapshot.marks?.length>0&&<details><summary>View authorised marks</summary><div className="table-wrap"><table><thead><tr><th>Student ID</th><th>Exam ID</th><th>Subject ID</th><th>Score</th><th>Verified</th></tr></thead><tbody>{offlineSnapshot.marks.slice(0,200).map((row:any)=><tr key={row.id}><td>{row.student_id}</td><td>{row.exam_id}</td><td>{row.subject_id}</td><td>{row.score}</td><td>{row.verified?'Yes':'No'}</td></tr>)}</tbody></table></div></details>}
        {(offlineSnapshot.charges?.length||offlineSnapshot.payments?.length||offlineSnapshot.class_fees?.length)>0&&<details><summary>View authorised finance records</summary><div className="table-wrap"><table><thead><tr><th>Record</th><th>Reference</th><th>Amount</th><th>Description</th></tr></thead><tbody>
          {offlineSnapshot.charges.slice(0,200).map((row:any)=><tr key={'c'+row.id}><td>Charge</td><td>Student #{row.student_id}</td><td>{row.amount}</td><td>{row.description||row.term}</td></tr>)}
          {offlineSnapshot.payments.slice(0,200).map((row:any)=><tr key={'p'+row.id}><td>Payment</td><td>Charge #{row.charge_id}</td><td>{row.amount}</td><td>{row.receipt_number||row.payment_date}</td></tr>)}
          {offlineSnapshot.class_fees.slice(0,200).map((row:any)=><tr key={'f'+row.id}><td>Class fee</td><td>Class #{row.class_id}</td><td>{row.amount}</td><td>{row.term} {row.year}</td></tr>)}
        </tbody></table></div></details>}
      </div>}
    </div>
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
