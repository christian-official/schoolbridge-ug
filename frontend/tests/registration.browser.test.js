import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { chromium } from 'playwright'

const baseUrl = 'http://127.0.0.1:4174'
const schoolId = '00000000-0000-4000-8000-000000000001'
const configuredApiOrigin = process.env.VITE_API_BASE_URL || new URL(baseUrl).origin

test('QR access opens the correct school registration flow on a mobile viewport and calls the shared API', async () => {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  let browser
  const apiRequests = []
  let submittedPayload

  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(baseUrl)
        if (response.ok) { ready = true; break }
      } catch { /* Vite preview is still starting. */ }
      await delay(500)
    }
    assert.equal(ready, true, 'Vite preview should become available')

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    const frontendOrigin = new URL(baseUrl).origin

    await page.route('**/api/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      apiRequests.push({ origin: url.origin, path: url.pathname, method: request.method() })
      const corsHeaders = {
        'access-control-allow-origin': frontendOrigin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      }
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders })
        return
      }
      if (url.pathname === '/api/setup/status' && request.method() === 'GET') {
        await route.fulfill({
          status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            installation_id: 'mobile-qr-installation', activated: true, setup_completed: true,
            requires_activation: false, requires_setup: false, identity_locked: true, school_id: schoolId,
          }),
        })
        return
      }
      if (url.pathname === '/api/public/school' && request.method() === 'GET') {
        await route.fulfill({
          status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ school_id: schoolId, school_name: 'Mobile QR Test School', school_type: 'Secondary' }),
        })
        return
      }
      if (url.pathname === '/api/public/registration/parent' && request.method() === 'POST') {
        submittedPayload = request.postDataJSON()
        await route.fulfill({
          status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            access_token: 'mobile-qr-parent-session', token_type: 'bearer',
            role: 'parent', username: 'parent-mobile-test',
            message: 'Your details have been verified. Opening your parent dashboard.',
          }),
        })
        return
      }
      if (url.pathname === '/api/auth/me' && request.method() === 'GET') {
        await route.fulfill({
          status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 41, school_id: schoolId, username: 'parent-mobile-test', email: null, role: 'parent',
            role_label: 'Parent', permissions: {}, active: true, must_change_password: false,
          }),
        })
        return
      }
      if (url.pathname === '/api/parent/children' && request.method() === 'GET') {
        await route.fulfill({
          status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify([{
            id: 7, name: 'Test Learner', admission_number: 'TEST-001', status: 'active',
            class_name: 'Primary 3', stream: '', fees_charged: 0, fees_paid: 0, balance: 0,
          }]),
        })
        return
      }
      if (url.pathname === '/api/parent/children/7/results' && request.method() === 'GET') {
        await route.fulfill({
          status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify([]),
        })
        return
      }
      await route.fulfill({
        status: 404, headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ detail: 'Unexpected browser test API request.' }),
      })
    })

    await page.goto(baseUrl + '/?school=' + schoolId + '&audience=parent')
    await page.getByRole('heading', { name: 'Join your school' }).waitFor()
    await page.getByText('Mobile QR Test School', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Continue as parent', exact: true }).click()
    await page.getByRole('dialog', { name: 'Parent details' }).waitFor()
    const registrationWidth = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(registrationWidth.document <= registrationWidth.viewport, `QR registration must fit a phone viewport: ${JSON.stringify(registrationWidth)}`)

    assert.equal(await page.locator('input[name="phone"]').count(), 0, 'registration must not collect a replacement verification phone')
    await page.getByLabel('Your full name as recorded by the school').fill('Test Parent')
    await page.getByLabel('Relationship to the child(ren)').fill('Guardian')
    await page.getByLabel('First name').fill('Test')
    await page.getByLabel('Last name').fill('Learner')
    assert.equal(await page.getByLabel('Admission number').count(), 0, 'parent registration must not require an admission number')

    await page.getByRole('button', { name: 'Verify and open my dashboard' }).click()
    await page.getByRole('heading', { name: 'My children', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Test Learner', exact: true }).waitFor()
    assert.deepEqual(submittedPayload, {
      school_id: schoolId,
      parent_name: 'Test Parent',
      relationship: 'Guardian',
      children: [{ first_name: 'Test', last_name: 'Learner', date_of_birth: null, class_name: null }],
    })
    assert.ok(apiRequests.length >= 3, 'setup, school identity and registration should call the API')
    assert.ok(apiRequests.every(request => request.origin === configuredApiOrigin), `every QR flow request must use the configured shared API origin: ${JSON.stringify(apiRequests)}`)

    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('heading', { name: 'Join your school' }).waitFor()
    assert.equal(await page.getByLabel('Password').count(), 0, 'a signed-out parent must return to passwordless QR verification')
    await page.getByRole('button', { name: 'Continue as parent', exact: true }).click()
    await page.getByRole('dialog', { name: 'Parent details' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Verify and open my dashboard' }).count(), 1, 'the existing parent must be able to verify again without creating a password account')

    await context.close()
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
})


test('QR teacher registration verifies staff details and opens the teacher dashboard directly', async () => {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
    stdio: 'ignore', shell: process.platform === 'win32',
  })
  let browser
  let submittedPayload
  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { const response = await fetch(baseUrl); if (response.ok) { ready = true; break } } catch { /* Preview is starting. */ }
      await delay(500)
    }
    assert.equal(ready, true, 'Vite preview should become available')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const frontendOrigin = new URL(baseUrl).origin
    await page.route('**/api/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const headers = { 'access-control-allow-origin': frontendOrigin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' }
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
      if (url.pathname === '/api/setup/status') {
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ installation_id: 'teacher-qr-installation', activated: true, setup_completed: true, requires_activation: false, requires_setup: false, identity_locked: true, school_id: schoolId }) }); return
      }
      if (url.pathname === '/api/public/school') {
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ school_id: schoolId, school_name: 'Teacher QR Test School', school_type: 'Secondary' }) }); return
      }
      if (url.pathname === '/api/public/registration/teacher' && request.method() === 'POST') {
        submittedPayload = request.postDataJSON()
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ access_token: 'teacher-qr-session', role: 'teacher', username: 'teacher-qr-test', message: 'Verified. Opening dashboard.' }) }); return
      }
      if (url.pathname === '/api/auth/me') {
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ id: 52, school_id: schoolId, username: 'teacher-qr-test', email: null, role: 'teacher', role_label: 'Teacher', permissions: {}, active: true, must_change_password: false }) }); return
      }
      if (url.pathname === '/api/teacher/my-assignments' || url.pathname === '/api/teacher/my-class-teacher-assignments') {
        await route.fulfill({ status: 200, headers, body: '[]' }); return
      }
      await route.fulfill({ status: 404, headers, body: JSON.stringify({ detail: 'Unexpected teacher QR browser-test request.' }) })
    })
    await page.goto(baseUrl + '/?school=' + schoolId + '&audience=teacher')
    await page.getByRole('heading', { name: 'Join your school' }).waitFor()
    await page.getByRole('button', { name: 'Continue as teacher', exact: true }).click()
    await page.getByLabel('First name as recorded by the school').fill('Grace')
    await page.getByLabel('Last name as recorded by the school').fill('Teacher')
    await page.getByLabel('Staff number').fill('ST-QR-001')
    await page.getByRole('button', { name: 'Verify and open my dashboard' }).click()
    await page.getByRole('heading', { name: 'My assigned classes' }).waitFor()
    assert.deepEqual(submittedPayload, {
      school_id: schoolId, first_name: 'Grace', last_name: 'Teacher',
      staff_number: 'ST-QR-001', position: null, department: null,
    })
    assert.equal(await page.getByLabel('Password').count(), 0, 'teacher QR registration must not ask for a password')
    await page.close()
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
})
