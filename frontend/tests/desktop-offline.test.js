import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const devices = await readFile(new URL('../src/SyncDevices.tsx', import.meta.url), 'utf8')
const storage = await readFile(new URL('../src/syncStorage.ts', import.meta.url), 'utf8')
const desktopShell = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')

test('desktop offline sign-in remains reachable when the local API is unavailable', () => {
  assert.match(app, /const offlineLoginIndex = setupStatus\.error \? readOfflineLoginIndex\(selectedSchoolId\) : null/)
  assert.match(app, /if\(!setupStatus\.setup_completed && !offlineLoginIndex\)/)
  assert.match(app, /if\(setupStatus\.error && !offlineLoginIndex\)/)
})

test('offline login metadata and encrypted snapshot are bound to one installation', () => {
  assert.match(devices, /installationId:installation\.installation_id/)
  assert.match(devices, /installation_id:string;school_id:string;setup_completed:boolean;activated:boolean/)
  assert.match(app, /snapshot\.installationId!==index\.installationId/)
  assert.match(app, /index\.installationId !== installedIdentity/)
  assert.match(app, /localStorage\.setItem\('schoolbridge-installation-id', result\.installation_id\)/)
  assert.match(devices, /snapshot\.installationId!==installation\.installation_id/)
})

test('offline copies remain encrypted, expiring, and read-only', () => {
  assert.match(devices, /saveEncryptedOfflineSnapshot\(userId,deviceId,offlinePassphrase,snapshot\)/)
  assert.match(storage, /name: 'AES-GCM'/)
  assert.match(storage, /OFFLINE_SNAPSHOT_TTL_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(app, /Offline mode is read-only/)
})

test('desktop device sync uses the bundled loopback backend rather than the WebView origin', () => {
  assert.ok(devices.includes("window.location.hostname === 'tauri.localhost'"))
  assert.ok(devices.includes("const API_BASE_URL = isTauriDesktop"))
  assert.ok(devices.includes("? 'http://127.0.0.1:8080'"))
})
test('secure LAN clients use the local same-origin API instead of the hosted API', () => {
  assert.ok(app.includes("const isSchoolBridgeLanClient = typeof window"))
  assert.ok(app.includes("window.location.protocol === 'https:'"))
  assert.ok(app.includes("desktopApiBaseUrl || (isSchoolBridgeLanClient ? '' : configuredApiBaseUrl)"))
  assert.ok(devices.includes("const isSchoolBridgeLanClient = typeof window"))
  assert.ok(devices.includes("isSchoolBridgeLanClient ? '' : (import.meta.env.VITE_API_BASE_URL || '')"))
})
test('desktop primary operation uses only its loopback backend and local data directory', () => {
  assert.match(app, /const desktopApiBaseUrl = isTauriDesktop \? 'http:\/\/127\.0\.0\.1:8080'/)
  assert.match(desktopShell, /"--host", "127\.0\.0\.1"/)
  assert.match(desktopShell, /\.env\("SCHOOLBRIDGE_DATA_DIR", &data_dir\)/)
  assert.match(desktopShell, /schoolbridge\.sqlite3/)
  assert.match(app, /Local SchoolBridge service ready/)
  assert.match(app, /Local SchoolBridge service unavailable/)
})


test('offline session startup suppresses network errors and preserves the saved token', () => {
  assert.match(app, /if \(response\.status >= 500\) throw new TypeError\('SchoolBridge server is temporarily unavailable\.'\)/)
  assert.match(app, /const connectionUnavailable = error instanceof TypeError \|\| !navigator\.onLine/)
  assert.match(app, /if \(!connectionUnavailable\) void clearStoredSessionToken\(\)/)
  assert.match(app, /setLoginError\(connectionUnavailable \? ''/)
})
