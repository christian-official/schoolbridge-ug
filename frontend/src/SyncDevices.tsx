import { useCallback, useEffect, useState } from 'react'

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

type Props = { token: string; userId: number }
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

export default function SyncDevices({ token, userId }: Props) {
  const [devices, setDevices] = useState<Device[]>([])
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load registered devices.')
    } finally {
      setLoading(false)
    }
  }, [token, userId])

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
