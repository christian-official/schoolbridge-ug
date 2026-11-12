import { fetchSchoolBridge } from './offlineNetwork'
import { useCallback, useEffect, useState } from 'react'

type Device = {
  device_id: string; device_name: string; created_at: string; last_seen_at: string
  last_sync_sequence: number; last_issued_sequence: number; revoked_at: string | null; active: boolean
}
type Props = { token: string; userId: number; schoolId: string; isAdmin: boolean }
const isTauriDesktop = typeof window !== 'undefined' && (
  '__TAURI_INTERNALS__' in window || window.location.hostname === 'tauri.localhost' || window.location.protocol === 'tauri:'
)
function isPrivateLanAddress(hostname: string) {
  const octets = hostname.split('.').map(part => /^\d{1,3}$/.test(part) ? Number(part) : -1)
  if (octets.length !== 4 || octets.some(part => part < 0 || part > 255)) return false
  const [first, second] = octets
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}
const isSchoolBridgeLanClient = typeof window !== 'undefined' && window.location.protocol === 'https:' && isPrivateLanAddress(window.location.hostname)
const API_BASE_URL = isTauriDesktop ? 'http://127.0.0.1:8080' : (isSchoolBridgeLanClient ? '' : (import.meta.env.VITE_API_BASE_URL || ''))
const deviceStorageKey = (userId: number) => 'schoolbridge-sync-device-' + userId
const browserDeviceName = () => {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const platform = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : 'Device'
  return (browser + ' on ' + platform).slice(0, 100)
}
async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchSchoolBridge(API_BASE_URL + '/api/' + path, {
    ...options, headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, cache: 'no-store',
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || 'Request failed: ' + response.status)
  return result as T
}

export default function SyncDevices({ token, userId, schoolId, isAdmin }: Props) {
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [schoolQrUrl, setSchoolQrUrl] = useState('')
  const [schoolAccessUrl, setSchoolAccessUrl] = useState('')
  const [qrUnavailableReason, setQrUnavailableReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const storedId = localStorage.getItem(deviceStorageKey(userId)) || ''
      setDeviceId(storedId)
      const result = await request<{ devices: Device[] }>('sync/devices', token)
      setDevices(result.devices)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load registered devices.') }
    finally { setLoading(false) }
  }, [token, userId])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!isAdmin || isTauriDesktop) return
    const host = window.location.hostname.toLowerCase()
    if (window.location.protocol !== 'https:' || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      setQrUnavailableReason('Open SchoolBridge from its shared HTTPS school address to create a mobile QR code.')
      return
    }
    let objectUrl = ''
    const controller = new AbortController()
    const destination = window.location.origin + '/?school='
    fetchSchoolBridge(API_BASE_URL + '/api/enrolment/school-qr.svg?origin=' + encodeURIComponent(window.location.origin), {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Unable to create the school access QR code.')
      return response.blob()
    }).then(blob => { objectUrl = URL.createObjectURL(blob); setSchoolQrUrl(objectUrl) })
      .catch(err => { if (err.name !== 'AbortError') setError(err instanceof Error ? err.message : 'Unable to create the school access QR code.') })
    fetchSchoolBridge(API_BASE_URL + '/api/public/school?school=' + encodeURIComponent(schoolId), { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('School identity is unavailable.')))
      .then(identity => setSchoolAccessUrl(destination + encodeURIComponent(identity.school_id)))
      .catch(err => { if (err.name !== 'AbortError') setError(err instanceof Error ? err.message : 'Unable to load school identity.') })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [isAdmin, schoolId, token])

  async function register(replaceIdentity = false) {
    setBusy(true); setError(''); setMessage('')
    try {
      let id = replaceIdentity ? crypto.randomUUID() : deviceId
      if (!id) id = crypto.randomUUID()
      await request<Device>('sync/devices', token, { method: 'POST', body: JSON.stringify({ device_id: id, device_name: browserDeviceName() }) })
      localStorage.setItem(deviceStorageKey(userId), id)
      setDeviceId(id)
      setMessage(replaceIdentity ? 'A new device identity has been registered.' : 'This browser is now registered.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to register this device.') }
    finally { setBusy(false) }
  }
  async function revoke(id: string) {
    if (!window.confirm('Revoke this device? It will no longer be recognised as a registered device.')) return
    setBusy(true); setError(''); setMessage('')
    try {
      await request('sync/devices/' + encodeURIComponent(id), token, { method: 'DELETE' })
      setMessage('Device access revoked.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to revoke this device.') }
    finally { setBusy(false) }
  }

  const currentDevice = devices.find(device => device.device_id === deviceId)
  const currentRevoked = Boolean(currentDevice && !currentDevice.active)
  return <section className="panel settings-panel sync-devices-panel">
    <div className="panel-heading"><div><h2>Registered devices</h2><p>Review browsers and computers registered to your SchoolBridge account.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || busy}>Refresh</button></div>
    <p className="form-hint">Manage the devices associated with your account. School records and dashboards are retrieved directly from the school server.</p>
    {isAdmin && !isTauriDesktop && <section className="offline-record-tools school-access-qr">
      <h3>School mobile access QR</h3>
      <p className="form-hint">This reusable QR code opens this school's SchoolBridge registration page. Parents and teachers enter their details, which are checked automatically against the school's existing records. Successful verification opens the correct dashboard; the QR code itself does not expose student records or grant access.</p>
      {qrUnavailableReason ? <p className="form-hint">{qrUnavailableReason}</p> : schoolQrUrl ? <div className="school-access-qr-content">
        <img src={schoolQrUrl} alt="Reusable SchoolBridge school access QR code" width="240" height="240" />
        <div><strong>School access link</strong><input readOnly value={schoolAccessUrl} onFocus={event => event.currentTarget.select()} aria-label="School access link" />
          <div className="proposal-review-actions">
            <button className="secondary-button" type="button" onClick={() => { void navigator.clipboard?.writeText(schoolAccessUrl).then(() => setMessage('School access link copied.')).catch(() => setMessage('Select and copy the school access link manually.')) }}>Copy access link</button>
            <button className="secondary-button" type="button" onClick={() => window.print()}>Print QR</button>
          </div>
        </div>
      </div> : <p className="form-hint">Preparing the school QR code…</p>}
    </section>}
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
      <h3>Devices linked to this account</h3>
      {devices.length === 0 ? <p className="empty-state">No devices have been registered yet.</p> : <div className="table-wrap"><table><thead><tr><th>Device</th><th>Status</th><th>Last seen</th><th>Action</th></tr></thead><tbody>
        {devices.map(device => <tr key={device.device_id}>
          <td><strong>{device.device_name}</strong>{device.device_id === deviceId && <small className="form-hint">This browser</small>}</td>
          <td>{device.active ? 'Active' : 'Revoked'}</td>
          <td>{device.last_seen_at ? new Date(device.last_seen_at + (device.last_seen_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}</td>
          <td>{device.active ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void revoke(device.device_id)}>Revoke</button> : '—'}</td>
        </tr>)}
      </tbody></table></div>}
    </>}
  </section>
}
