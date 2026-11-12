import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const flow = await readFile(new URL('../src/RegistrationFlow.tsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const backend = await readFile(new URL('../../backend/app/main.py', import.meta.url), 'utf8')
const syncDevices = await readFile(new URL('../src/SyncDevices.tsx', import.meta.url), 'utf8')

test('scanning a school QR opens that school registration page directly', () => {
  assert.match(app, /useState\(\(\) => Boolean\(new URLSearchParams\(window\.location\.search\)\.get\('school'\)\)\)/)
  assert.match(app, /<RegistrationFlow schoolId=\{selectedSchoolId\}/)
  assert.match(app, /\/api\/public\/school\?school=/)
  assert.match(syncDevices, /SchoolBridge registration page/)
  assert.match(syncDevices, /setSchoolAccessUrl\(destination \+ encodeURIComponent\(identity\.school_id\)\)/)
})

test('parent and teacher registration submits existing-record details without passwords, phone codes or administrator review', () => {
  assert.match(flow, /public\/registration\/parent/)
  assert.match(flow, /public\/registration\/teacher/)
  assert.match(flow, /onAuthenticated\(result\.access_token\)/)
  assert.doesNotMatch(flow, /type=["']password|name=["']phone|public\/registration\/claims|pending_review|verification_pending|username:\s/)
  assert.doesNotMatch(backend, /@app\.(get|post)\(["']\/api\/admin\/registration-claims/)
  assert.doesNotMatch(backend, /@app\.(get|post)\(["']\/api\/public\/registration\/claims/)
})

test('parent verification matches each child and guardian against records in the selected school', () => {
  assert.match(backend, /def _match_parent_registration/)
  assert.match(backend, /models\.StudentGuardianContact/)
  assert.match(backend, /models\.Student\.school_tenant_id == tenant_id/)
  assert.match(flow, /Add another child/)
  assert.match(flow, /children: children\.map/)
  assert.match(flow, /admission_number/)
  assert.match(flow, /date_of_birth/)
})

test('teacher verification matches an active teaching staff record and opens the teacher dashboard', () => {
  assert.match(backend, /def _match_teacher_registration/)
  assert.match(backend, /models\.StaffMember\.staff_number/)
  assert.match(backend, /def submit_teacher_registration[\s\S]*?_create_qr_registration_session/)
  assert.match(flow, /staff_number/)
  assert.match(flow, /Verify and open my dashboard/)
})

test('successful QR verification issues a session directly without account password creation', () => {
  assert.match(backend, /def _create_qr_registration_session/)
  assert.match(backend, /"access_token": create_access_token\(user\)/)
  assert.match(app, /storeSessionToken\(accessToken\);setToken\(accessToken\)/)
  assert.doesNotMatch(flow, /Create password|Choose a password|username:\s*username/)
})
