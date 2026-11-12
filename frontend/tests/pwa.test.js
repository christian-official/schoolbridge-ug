import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'

const publicDir = new URL('../public/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const entry = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const installUi = await readFile(new URL('../src/PWAInstallPrompt.tsx', import.meta.url), 'utf8')

test('web app manifest has installable standalone metadata and valid icons', async () => {
  assert.equal(manifest.name, 'SchoolBridge')
  assert.equal(manifest.short_name, 'SchoolBridge')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/')
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.type === 'image/png'))
  assert.ok(manifest.icons.some(icon => icon.sizes === 'any' && icon.type === 'image/svg+xml'))
  for (const icon of manifest.icons) {
    await access(new URL(icon.src.replace(/^\//, ''), publicDir))
  }
})

test('document declares mobile and Apple home-screen metadata', () => {
  assert.match(html, /name="viewport"[^>]*width=device-width/)
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(html, /rel="apple-touch-icon"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
})

test('production entry registers the service worker and exposes install guidance', () => {
  assert.match(entry, /serviceWorker\.register\('\/service-worker\.js'\)/)
  assert.match(installUi, /beforeinstallprompt/)
  assert.match(installUi, /Add to Home Screen/)
  assert.match(entry, /schoolbridge:pwa-update/)
  assert.match(installUi, /Update now/)
  assert.match(installUi, /SCHOOLBRIDGE_SKIP_WAITING/)
})
