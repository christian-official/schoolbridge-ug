import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const landing = await readFile(new URL('../src/SchoolAccessLanding.tsx', import.meta.url), 'utf8')

test('desktop app explains parent browser access before showing staff login', () => {
  assert.match(app, /isTauriDesktop && !showDesktopStaffLogin/)
  assert.match(app, /Parents do not have desktop-app usernames or passwords/)
  assert.match(app, /return to that browser tab/)
  assert.match(app, /setShowDesktopStaffLogin\(true\)/)
  assert.match(app, /Back to role selection/)
})

test('public school landing does not offer the staff desktop installer to parents', () => {
  assert.doesNotMatch(landing, /Download SchoolBridge for Windows/)
  assert.match(landing, /Administrator &amp; essential staff sign in/)
})
