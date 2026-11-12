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
            id: 41, username: 'parent-mobile-test', email: null, role: 'parent',
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

    await page.goto(baseUrl + '/?school=' + schoolId)
    await page.getByRole('heading', { name: 'Join your school' }).waitFor()
    await page.getByText('Mobile QR Test School').waitFor()
    const registrationWidth = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(registrationWidth.document <= registrationWidth.viewport, `QR registration must fit a phone viewport: ${JSON.stringify(registrationWidth)}`)

    assert.equal(await page.locator('input[name="phone"]').count(), 0, 'registration must not collect a replacement verification phone')
    await page.getByLabel('Your full name as recorded by the school').fill('Test Parent')
    await page.getByLabel('Relationship to the child(ren)').fill('Guardian')
    await page.getByLabel('First name').fill('Test')
    await page.getByLabel('Last name').fill('Learner')
    await page.getByLabel('Admission number').fill('TEST-001')

    await page.getByRole('button', { name: 'Verify and open my dashboard' }).click()
    await page.getByRole('heading', { name: 'My children' }).waitFor()
    await page.getByText('Test Learner').waitFor()
    assert.deepEqual(submittedPayload, {
      school_id: schoolId,
      parent_name: 'Test Parent',
      relationship: 'Guardian',
      children: [{ first_name: 'Test', last_name: 'Learner', admission_number: 'TEST-001', date_of_birth: null, class_name: null }],
    })
    assert.ok(apiRequests.length >= 3, 'setup, school identity and registration should call the API')
    assert.ok(apiRequests.every(request => request.origin === configuredApiOrigin), `every QR flow request must use the configured shared API origin: ${JSON.stringify(apiRequests)}`)

    await context.close()
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
})
