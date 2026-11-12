import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const devices = await readFile(new URL('../src/SyncDevices.tsx', import.meta.url), 'utf8')
const storage = await readFile(new URL('../src/syncStorage.ts', import.meta.url), 'utf8')

test('desktop sign-in requires a live server session and has no offline credential fallback', () => {
  assert.match(app, /api\/auth\/login/)
  assert.doesNotMatch(app, /readOfflineLoginIndex|OfflineWorkspace|offline passphrase|Password \/ offline/)
  assert.match(app, /Connect to the school server and try again/)
})

test('legacy encrypted local records are cleared after successful online authentication', () => {
  assert.match(app, /clearLocalSyncData\(user\.id, deviceId\)/)
  assert.match(app, /schoolbridge-offline-snapshot-meta-/)
  assert.match(app, /schoolbridge-offline-login-index/)
  assert.match(storage, /indexedDB\.deleteDatabase\('schoolbridge-offline-' \+ userId \+ '-' \+ deviceId\)/)
  assert.doesNotMatch(storage, /deriveOfflineDraftKey|saveEncryptedOfflineDraft|loadEncryptedOfflineDraft|saveEncryptedOfflineSnapshot|loadEncryptedOfflineSnapshot/)
})

test('device management keeps QR generation, device registration and revocation without offline enrollment', () => {
  assert.match(devices, /School mobile access QR/)
  assert.match(devices, /async function register\(/)
  assert.match(devices, /async function revoke\(/)
  assert.match(devices, /Devices linked to this account/)
  assert.doesNotMatch(devices, /offlinePassphrase|Download authorised records|Unlock saved records|enrolment\/invitations|redeemInvitation/)
})

test('connection failures explain that live school data requires reconnecting', () => {
  assert.match(app, /SchoolBridge cannot reach the server right now\. Reconnect to refresh live records/)
})
