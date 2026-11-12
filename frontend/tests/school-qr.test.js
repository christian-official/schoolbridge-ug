import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const syncDevices = await readFile(new URL('../src/SyncDevices.tsx', import.meta.url), 'utf8')

test('manual school QR access link uses the public school ID, not the local installation ID', () => {
  assert.match(syncDevices, /setSchoolAccessUrl\(destination \+ encodeURIComponent\(identity\.school_id\)\)/)
  assert.doesNotMatch(syncDevices, /setSchoolAccessUrl\(destination \+ encodeURIComponent\(identity\.installation_id\)\)/)
})


test('device management resolves the public school identity in the signed-in admin tenant', () => {
  assert.match(syncDevices, /\/api\/public\/school\?school=' \+ encodeURIComponent\(schoolId\)/)
})
