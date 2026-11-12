import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const flow = await readFile(new URL('../src/RegistrationFlow.tsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('QR-selected school login exposes parent and teacher self-registration', () => {
  assert.match(app, /Create a parent or teacher account/)
  assert.match(app, /<RegistrationFlow schoolId={selectedSchoolId}/)
  assert.match(flow, /public\/registration\/parent/)
  assert.match(flow, /public\/registration\/teacher/)
})

test('registration supports trusted-phone verification and school review without collecting a replacement phone', () => {
  assert.match(flow, /verification_pending/)
  assert.match(flow, /phone_masked|maskedPhone/)
  assert.match(flow, /public\/registration\/claims\//)
  assert.match(flow, /pending_review/)
  assert.doesNotMatch(flow, /name=["']phone["']/i)
})

test('parent registration supports multiple children and optional admission numbers', () => {
  assert.match(flow, /Add another child/)
  assert.match(flow, /Admission number \(optional\)/)
  assert.match(flow, /children: children\.map/)
})

test('account completion sends only school, chosen username and password', () => {
  assert.match(flow, /username: username\.trim\(\), password/)
  assert.match(flow, /school_id: schoolId/)
})
