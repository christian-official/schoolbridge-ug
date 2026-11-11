import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { firefox } from 'playwright'

const baseUrl = 'http://127.0.0.1:4174'

test('Firefox legacy-client smoke test covers app boot and required browser APIs', async () => {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
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

    browser = await firefox.launch({ headless: true })
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0)
    assert.equal(await page.title(), 'SchoolBridge')

    const capabilities = await page.evaluate(async () => {
      const workerSupported = 'serviceWorker' in navigator
      const cryptoSupported = Boolean(globalThis.crypto?.subtle)
      const indexedDbSupported = Boolean(globalThis.indexedDB)
      const cacheSupported = Boolean(globalThis.caches)
      let indexedDbRoundTrip = false

      if (indexedDbSupported) {
        indexedDbRoundTrip = await new Promise(resolve => {
          const request = indexedDB.open('schoolbridge-legacy-browser-probe', 1)
          request.onupgradeneeded = () => request.result.createObjectStore('probe')
          request.onerror = () => resolve(false)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('probe', 'readwrite')
            transaction.objectStore('probe').put('ok', 'status')
            transaction.oncomplete = () => {
              const read = db.transaction('probe').objectStore('probe').get('status')
              read.onsuccess = () => { db.close(); resolve(read.result === 'ok') }
              read.onerror = () => { db.close(); resolve(false) }
            }
            transaction.onerror = () => { db.close(); resolve(false) }
          }
        })
      }

      return { workerSupported, cryptoSupported, indexedDbSupported, cacheSupported, indexedDbRoundTrip }
    })

    assert.equal(capabilities.workerSupported, true, 'service workers must be available')
    assert.equal(capabilities.cryptoSupported, true, 'Web Crypto must be available')
    assert.equal(capabilities.indexedDbSupported, true, 'IndexedDB must be available')
    assert.equal(capabilities.cacheSupported, true, 'Cache Storage must be available')
    assert.equal(capabilities.indexedDbRoundTrip, true, 'IndexedDB must complete a write/read round trip')
    assert.deepEqual(pageErrors, [], 'the application should not raise uncaught browser errors')
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
})
