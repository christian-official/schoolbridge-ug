import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const devices = await readFile(new URL('../src/SyncDevices.tsx', import.meta.url), 'utf8')
const storage = await readFile(new URL('../src/syncStorage.ts', import.meta.url), 'utf8')

test('desktop offline sign-in remains reachable when the local API is unavailable', () => {
  assert.match(app, /const offlineLoginIndex = setupStatus\.error \? readOfflineLoginIndex\(\) : null/)
  assert.match(app, /if\(!setupStatus\.setup_completed && !offlineLoginIndex\)/)
  assert.match(app, /if\(setupStatus\.error && !offlineLoginIndex\)/)
})

test('offline login metadata and encrypted snapshot are bound to one installation', () => {
  assert.match(devices, /installationId:installation\.installation_id/)
  assert.match(devices, /installation_id:installation\.installation_id/)
  assert.match(app, /snapshot\.installationId!==index\.installationId/)
  assert.match(devices, /snapshot\.installationId!==installation\.installation_id/)
})

test('offline copies remain encrypted, expiring, and read-only', () => {
  assert.match(devices, /saveEncryptedOfflineSnapshot\(userId,deviceId,offlinePassphrase,snapshot\)/)
  assert.match(storage, /name: 'AES-GCM'/)
  assert.match(storage, /OFFLINE_SNAPSHOT_TTL_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(app, /Offline mode is read-only/)
})
