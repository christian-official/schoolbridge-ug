import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { chromium } from 'playwright'

const baseUrl = 'http://127.0.0.1:4173'

test('real Chromium verifies the offline service-worker boundary', async () => {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  let browser

  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(baseUrl)
        if (response.ok) {
          ready = true
          break
        }
      } catch {
        // Vite preview is still starting.
      }
      await delay(500)
    }
    assert.equal(ready, true, 'Vite preview should become available')

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(baseUrl)
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    await page.evaluate(() => navigator.serviceWorker.ready)
    // The first navigation installs the worker but is not yet controlled. Reload
    // once so the worker can observe and cache the built JS/CSS requests.
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.title(), 'SchoolBridge')

    const manifestResponse = await page.request.get(`${baseUrl}/manifest.webmanifest`)
    assert.equal(manifestResponse.ok(), true, 'the install manifest should be served')
    const manifest = await manifestResponse.json()
    assert.equal(manifest.display, 'standalone')
    assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'))

    await page.setViewportSize({ width: 360, height: 800 })
    const mobileLayout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    assert.ok(mobileLayout.document <= mobileLayout.viewport, `mobile document must not overflow horizontally: ${JSON.stringify(mobileLayout)}`)
    assert.ok(mobileLayout.body <= mobileLayout.viewport, `mobile body must not overflow horizontally: ${JSON.stringify(mobileLayout)}`)
    await page.setViewportSize({ width: 1440, height: 900 })

    assert.equal(
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
      true,
      'the reloaded page should remain controlled by the service worker',
    )

    const cachedAssets = await page.evaluate(async () => {
      const cache = await caches.open('schoolbridge-shell-v1')
      const requests = await cache.keys()
      return requests.map(request => new URL(request.url).pathname)
    })
    assert.ok(cachedAssets.some(path => path.startsWith('/assets/')), 'built static assets should be cached')

    // A page fetch() has an empty request destination, so it is deliberately
    // outside the worker's script/style caching rule. Navigate instead: the
    // browser requests the built JS/CSS with their real destinations.
    await context.setOffline(true)
    await page.goto(new URL('/students', baseUrl).toString())
    assert.equal(await page.title(), 'SchoolBridge', 'offline navigation should fall back to the app shell')
    await page.getByRole('status').filter({ hasText: "You're offline." }).waitFor()
    assert.equal(await page.getByText('Unable to check setup').count(), 0, 'offline startup should show guidance instead of a network error')
    await page.waitForFunction(
      () => document.querySelector('#root')?.childElementCount > 0,
      { timeout: 5000 },
    )

    const apiResult = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/__offline_browser_probe')
        return { fulfilled: true, status: response.status }
      } catch {
        return { fulfilled: false }
      }
    })
    assert.equal(apiResult.fulfilled, false, 'API requests must not be fulfilled from the service-worker cache')

    await context.close()
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
})


test('real Chromium completes the first-install owner activation and school setup wizard', async () => {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  let browser

  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(baseUrl)
        if (response.ok) {
          ready = true
          break
        }
      } catch {
        // Vite preview is still starting.
      }
      await delay(500)
    }
    assert.equal(ready, true, 'Vite preview should become available')

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const installationId = 'a2b3c4d5-e6f7-4890-8123-456789abcdef'
    let activationPayload
    let setupPayload
    let installationActivated = false

    await page.route('**/api/setup/status', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        installation_id: installationId,
        activated: installationActivated,
        setup_completed: false,
        requires_activation: !installationActivated,
        requires_setup: true,
        identity_locked: false,
      }),
    }))
    await page.route('**/api/setup/activate', async route => {
      activationPayload = route.request().postDataJSON()
      installationActivated = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'SchoolBridge installation activated.', activated: true }),
      })
    })
    await page.route('**/api/setup/complete', async route => {
      setupPayload = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'School setup completed.',
          school: {
            school_name: setupPayload.school_name,
            school_type: setupPayload.school_type,
            country: setupPayload.country,
            school_structure: setupPayload.school_structure,
            installation_id: installationId,
          },
        }),
      })
    })

    await page.goto(baseUrl)
    await page.getByRole('heading', { name: 'Activate this installation' }).waitFor()
    assert.equal(await page.getByText(installationId).count(), 1)
    await page.setViewportSize({ width: 360, height: 800 })
    const activationLayout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(activationLayout.document <= activationLayout.viewport, `activation page must fit mobile viewport: ${JSON.stringify(activationLayout)}`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByLabel('CHRISTIAN Owner Key activation code').fill('signed-owner-license-token')
    await page.getByRole('button', { name: 'Activate installation' }).click()
    await page.getByRole('heading', { name: 'Set up your school' }).waitFor()
    assert.deepEqual(activationPayload, { license: 'signed-owner-license-token' })
    assert.equal(await page.getByLabel('Confirm CHRISTIAN Owner Key activation code').inputValue(), 'signed-owner-license-token')
    await page.setViewportSize({ width: 360, height: 800 })
    const schoolSetupLayout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(schoolSetupLayout.document <= schoolSetupLayout.viewport, `school setup page must fit mobile viewport: ${JSON.stringify(schoolSetupLayout)}`)
    await page.setViewportSize({ width: 1280, height: 900 })

    // Non-secret school identity fields survive a refresh in this browser tab.
    // The activation code and administrator credentials must be entered again.
    await page.getByLabel('Official school name *').fill('River Valley School')
    await page.getByLabel('Country *').fill('Uganda')
    await page.getByLabel('Administrator username *').fill('first-admin')
    await page.getByLabel('Administrator email *').fill('admin@example.invalid')
    await page.getByLabel('Private password *').fill('LongTestPassword123!')
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Set up your school' }).waitFor()
    assert.equal(await page.getByLabel('Confirm CHRISTIAN Owner Key activation code').inputValue(), '')
    assert.equal(await page.getByLabel('Official school name *').inputValue(), 'River Valley School')
    assert.equal(await page.getByLabel('Country *').inputValue(), 'Uganda')
    assert.equal(await page.getByLabel('Administrator username *').inputValue(), '')
    assert.equal(await page.getByLabel('Administrator email *').inputValue(), '')
    assert.equal(await page.getByLabel('Private password *').inputValue(), '')
    const setupDraft = await page.evaluate(() => Object.values(sessionStorage).join(' '))
    assert.ok(!setupDraft.includes('signed-owner-license-token'))
    assert.ok(!setupDraft.includes('LongTestPassword123!'))
    await page.getByLabel('Confirm CHRISTIAN Owner Key activation code').fill('signed-owner-license-token')
    await page.getByLabel('Administrator username *').fill('first-admin')
    await page.getByLabel('Administrator email *').fill('admin@example.invalid')
    await page.getByLabel('Private password *').fill('LongTestPassword123!')
    await page.getByLabel('School type *').selectOption('Combined')
    await page.getByLabel('School structure *').selectOption('Both')
    await page.getByLabel('Physical address').fill('Kampala')
    await page.getByLabel('School phone').fill('+256700000000')
    await page.getByLabel('School email').fill('office@example.invalid')
    await page.getByLabel('School motto').fill('Learning together')
    await page.getByLabel('School logo (PNG, JPEG or WebP)').setInputFiles({
      name: 'school-logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('test-logo'),
    })
    await page.waitForFunction(() => document.querySelector('.first-setup-logo-preview')?.getAttribute('src')?.startsWith('data:image/png;base64,'))
    await page.getByLabel('House names (one per line)').fill('Lions\\nEagles')
    await page.getByLabel('Administrator username *').fill('first-admin')
    await page.getByLabel('Administrator email *').fill('admin@example.invalid')
    await page.getByLabel('Private password *').fill('LongTestPassword123!')
    await page.getByLabel('I have checked these official school details and confirm they are correct.').check()
    await page.getByRole('button', { name: 'Complete school setup' }).click()
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()

    assert.equal(setupPayload.school_name, 'River Valley School')
    assert.equal(setupPayload.school_type, 'Combined')
    assert.equal(setupPayload.school_structure, 'Both')
    assert.equal(setupPayload.country, 'Uganda')
    assert.equal(setupPayload.admin_username, 'first-admin')
    assert.equal(setupPayload.admin_email, 'admin@example.invalid')
    assert.equal(setupPayload.admin_password, 'LongTestPassword123!')
    assert.equal(setupPayload.activation_license, 'signed-owner-license-token')
    assert.ok(setupPayload.report_logo.startsWith('data:image/png;base64,'))
    assert.equal(setupPayload.house_names, 'Lions\\nEagles')
    assert.equal(await page.getByLabel('Password').count(), 1)
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
})
