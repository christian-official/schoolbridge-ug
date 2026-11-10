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
