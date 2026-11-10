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
    assert.equal(await page.title(), 'SchoolBridge')

    const cachedAssets = await page.evaluate(async () => {
      const cache = await caches.open('schoolbridge-shell-v1')
      const requests = await cache.keys()
      return requests.map(request => new URL(request.url).pathname)
    })
    assert.ok(cachedAssets.some(path => path.startsWith('/assets/')), 'built static assets should be cached')

    await context.setOffline(true)

    const cachedAssetPath = cachedAssets.find(path => path.startsWith('/assets/'))
    const cachedAssetResponse = await page.evaluate(async path => {
      const response = await fetch(path)
      return { ok: response.ok, status: response.status }
    }, cachedAssetPath)
    assert.equal(cachedAssetResponse.ok, true, 'cached static asset should remain available offline')

    await page.goto(new URL('/students', baseUrl).toString())
    assert.equal(await page.title(), 'SchoolBridge', 'offline navigation should fall back to the app shell')

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
