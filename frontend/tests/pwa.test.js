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


test('production build injects every generated JS, CSS and imported asset into the offline precache', async () => {
  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  const serviceWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8')
  assert.match(viteConfig, /build:\s*\{\s*manifest:\s*true\s*\}/)
  assert.match(viteConfig, /name:\s*'schoolbridge-offline-precache'/)
  assert.match(viteConfig, /entry\.file/)
  assert.match(viteConfig, /entry\.css/)
  assert.match(viteConfig, /entry\.assets/)
  assert.match(viteConfig, /PRECACHE_ASSETS/)
  assert.match(serviceWorker, /cache\.addAll\(\[\.\.\.APP_SHELL, \.\.\.PRECACHE_ASSETS\]\)/)
})


test('API workspaces replace raw offline network failures with consistent guidance', async () => {
  const helper = await readFile(new URL('../src/offlineNetwork.ts', import.meta.url), 'utf8')
  assert.match(helper, /SchoolBridge cannot reach its server right now/)
  assert.match(helper, /server is temporarily unavailable/)
  assert.match(helper, /502, 503, 504/)
  for (const module of ['App.tsx', 'AcademicManagement.tsx', 'AttendanceManagement.tsx', 'MyStaffProfile.tsx', 'OperationsManagement.tsx', 'ParentLiaison.tsx', 'Phase4Workspace.tsx', 'RegistrationFlow.tsx', 'StaffFinance.tsx', 'SyncDevices.tsx']) {
    const source = await readFile(new URL('../src/' + module, import.meta.url), 'utf8')
    assert.match(source, /fetchSchoolBridge/, module + ' should use the shared offline-aware request helper')
  }
})


test('connection indicator responds immediately to browser offline and online events', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /window\.addEventListener\('offline', handleOffline\)/)
  assert.match(app, /window\.addEventListener\('online', handleOnline\)/)
  assert.match(app, /Offline — reconnect to refresh live records/)
  assert.match(app, /window\.removeEventListener\('offline', handleOffline\)/)
  assert.match(app, /window\.removeEventListener\('online', handleOnline\)/)
})

test('reconnect invalidates encrypted offline access when the registered device is revoked', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /api<.*devices.*>\('sync\\/devices', token\)/)
  assert.match(app, /find\(device => device\.device_id === deviceId\)/)
  assert.match(app, /if \(!currentDevice\?\.active\)/)
  assert.match(app, /deleteEncryptedOfflineSnapshot\(user\.id, deviceId\)/)
  assert.match(app, /localStorage\.removeItem\('schoolbridge-offline-login-index'\)/)
})

test('role or permission changes clear the full local offline database and pending drafts', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /if \(meta\.fingerprint !== fingerprint\)[\s\S]*?clearLocalSyncData\(user\.id, deviceId\)/)
  assert.match(app, /Permission\/role changes invalidate both cached records and offline drafts/)
})
