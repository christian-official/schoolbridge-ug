import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'

const publicDir = new URL('../public/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const entry = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const installUi = await readFile(new URL('../src/PWAInstallPrompt.tsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const accessGate = await readFile(new URL('../src/PWAAccessGate.tsx', import.meta.url), 'utf8')

test('web app manifest has installable standalone metadata and valid icons', async () => {
  assert.equal(manifest.name, 'SchoolBridge')
  assert.equal(manifest.short_name, 'SchoolBridge')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/')
  assert.ok(manifest.icons.some(icon => icon.src === '/icons/schoolbridge-app-icon.png' && icon.sizes === '192x192' && icon.type === 'image/png'))
  assert.ok(manifest.icons.some(icon => icon.src === '/icons/schoolbridge-app-icon-512.png' && icon.sizes === '512x512' && icon.type === 'image/png'))
  assert.ok(manifest.icons.some(icon => icon.src === '/app-icon.svg' && icon.sizes === 'any' && icon.type === 'image/svg+xml'))
  assert.match(await readFile(new URL('../public/app-icon.svg', import.meta.url), 'utf8'), /fill="#173b63"/)
  assert.match(html, /rel="apple-touch-icon" sizes="192x192" href="\/icons\/schoolbridge-app-icon\.png"/)
  assert.match(await readFile(new URL('../public/app-icon.svg', import.meta.url), 'utf8'), /fill="#fff"/)
  for (const icon of manifest.icons) {
    await access(new URL(icon.src.replace(/^\//, ''), publicDir))
  }
})

test('document declares mobile and Apple home-screen metadata', () => {
  assert.match(html, /name="viewport"[^>]*width=device-width/)
  assert.match(html, /Select the role-aware manifest before the browser evaluates PWA installability/)
  assert.match(html, /document\.head\.appendChild\(link\)/)
  assert.match(html, /'parent', 'teacher', 'staff'/)
  assert.match(html, /audience=' \+ audience/)
  assert.match(html, /id: school && \['parent', 'teacher', 'staff'\]\.includes\(audience\)/)
  assert.match(html, /rel="apple-touch-icon"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
})

test('production entry registers the service worker and exposes install guidance', () => {
  assert.match(entry, /serviceWorker\.register\('\/service-worker\.js'\)/)
  // The browser event is captured in the production entry before React mounts;
  // the prompt UI consumes the forwarded event through the shared window property.
  assert.match(entry, /beforeinstallprompt/)
  assert.match(entry, /event\.preventDefault\(\)/)
  assert.match(entry, /schoolBridgeInstallPrompt/)
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
  assert.match(helper, /SchoolBridge could not complete this server request/)
  assert.match(helper, /server is temporarily unavailable/)
  assert.match(helper, /\[502, 503, 504\]/)
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

test('offline passphrases, cached record snapshots and offline marks drafts are no longer part of account access', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const devices = await readFile(new URL('../src/SyncDevices.tsx', import.meta.url), 'utf8')
  const storage = await readFile(new URL('../src/syncStorage.ts', import.meta.url), 'utf8')
  const academic = await readFile(new URL('../src/AcademicManagement.tsx', import.meta.url), 'utf8')
  const attendance = await readFile(new URL('../src/AttendanceManagement.tsx', import.meta.url), 'utf8')
  const finance = await readFile(new URL('../src/StaffFinance.tsx', import.meta.url), 'utf8')
  for (const [name, source] of Object.entries({ app, devices, academic, attendance, finance, storage })) {
    assert.doesNotMatch(source, /offlinePassphrase|offline passphrase|Offline passphrase|EncryptedOffline|saveEncrypted|loadEncrypted|unlockOffline|offline queue passphrase/, name + ' must not expose offline passphrase workflows')
  }
  assert.match(app, /clearLocalSyncData\(user\.id, deviceId\)/)
  assert.match(academic, /Submit class results/)
  assert.match(attendance, /Save class attendance/)
  assert.match(finance, /Record payment and issue receipt/)
  assert.match(devices, /School mobile access QR/)
  assert.match(devices, /Devices linked to this account/)
  assert.match(devices, /async function revoke\(/)
})

test('Android uses the native install prompt when available and never promises a forced install', () => {
  assert.match(entry, /beforeinstallprompt/)
  assert.match(entry, /schoolBridgeInstallPrompt/)
  assert.match(installUi, /promptEvent\.prompt\(\)/)
  assert.match(installUi, /This browser has not provided an install prompt/)
})

test('iOS explains the Safari Home Screen flow because iOS does not expose a web install prompt', () => {
  assert.match(installUi, /Add SchoolBridge to your Home Screen/)
  assert.match(installUi, /In Safari, tap/)
  assert.match(installUi, /Add to Home Screen/)
})


test('parent and teacher QR context is retained for standalone app verification, never browser forms', async () => {
  assert.match(app, /const isStandalonePwa[\s\S]*?display-mode: standalone/)
  assert.match(app, /getSchoolAudience\(\)/)
  assert.match(app, /schoolbridge-selected-audience/)
  assert.match(app, /isStandalonePwa && \['parent','teacher'\]/)
  assert.match(app, /if \(\['parent','teacher','staff'\]\.includes\(schoolAudience\) && selectedSchoolId && !isStandalonePwa\)/)
  assert.match(app, /<PWAAccessGate schoolId=\{selectedSchoolId\}/)
  assert.match(app, /showRegistration && selectedSchoolId && isStandalonePwa/)
  const gate = await readFile(new URL('../src/PWAAccessGate.tsx', import.meta.url), 'utf8')
  assert.match(gate, /Install SchoolBridge first/)
  assert.match(gate, /not on this website/)
  assert.match(gate, /Add to Home Screen/)
  assert.match(gate, /Install app/)
  assert.match(gate, /schoolBridgeInstallPrompt/)
})


test('parent, teacher and staff access links install the PWA with school and role in its launch URL', () => {
  assert.match(app, /\['parent','teacher','staff'\]\.includes\(schoolAudience\)/)
  assert.match(app, /PWAAccessGate schoolId=\{selectedSchoolId\}/)
  assert.match(accessGate, /type Audience = 'parent' \| 'teacher' \| 'staff'/)
  assert.match(html, /const school = params\.get\('school'\)/)
  assert.match(html, /const audience = params\.get\('audience'\)/)
  assert.match(html, /encodeURIComponent\(school\).*audience/)
  assert.match(html, /start_url:/)
  assert.match(html, /id: school && \['parent', 'teacher', 'staff'\]\.includes\(audience\)/)
  assert.match(accessGate, /promptEvent&&<button type="button" className="primary-button login-button" onClick=\{\(\)=>void install\(\)\}>Add to Home Screen<\/button>/)
  assert.doesNotMatch(accessGate, /disabled=\{!promptEvent\}/)
  assert.match(accessGate, /window.addEventListener\('schoolbridge:install-prompt',capture\)/)
  assert.doesNotMatch(accessGate, /URL.createObjectURL/)
  assert.match(accessGate, /await promptEvent\.prompt\(\)/)
  assert.match(accessGate, /onClick=\{\(\)=>void install\(\)\}/)
  assert.match(accessGate, /school-issued staff credentials/)
  assert.match(accessGate, /verification form will appear inside the installed app/)
})

test('all role-specific access links preserve school and audience in the installed PWA launch URL', () => {
  assert.match(html, /const school = params\.get\('school'\)/)
  assert.match(html, /const audience = params\.get\('audience'\)/)
  assert.match(html, /start_url: school && \['parent', 'teacher', 'staff'\]\.includes\(audience\)/)
  assert.match(html, /id: school && \['parent', 'teacher', 'staff'\]\.includes\(audience\)/)
  assert.match(accessGate, /school-issued staff credentials/)
})
 
test('desktop staff login does not advertise a native Windows download and gives Chrome install steps', () => {
  assert.doesNotMatch(app, /Download SchoolBridge for Windows/)
  assert.match(accessGate, /const edgeDesktop=/)
  assert.match(accessGate, /const firefoxDesktop=/)
  assert.match(accessGate, /const safariDesktop=/)
  assert.match(accessGate, /showInstallButton=\!\(audience==='staff'&&desktop&&\!promptEvent\)/)
  assert.match(accessGate, /App available/)
  assert.match(accessGate, /Web apps/)
  assert.match(accessGate, /File.*Add to Dock/)
  assert.match(accessGate, /showInstallButton&&<button type="button" className="primary-button login-button"/)
  assert.match(accessGate, /Add to Home Screen/)
  assert.doesNotMatch(accessGate, /Install page as app/)
})

test('staff installation instructions support iPhone, Android and desktop without changing staff sign-in', () => {
  assert.match(accessGate, /On iPhone or iPad/)
  assert.match(accessGate, /Add to Home Screen/)
  assert.match(accessGate, /On Android/)
  assert.match(accessGate, /Install app/)
  assert.match(accessGate, /Open SchoolBridge from your Home Screen or app list and sign in with your school-issued staff credentials/)
  assert.match(accessGate, /Add to Home Screen/)
  assert.doesNotMatch(accessGate, /Install page as app/)
})


test('school device management provides a school-specific staff QR and staff access link', async () => {
  const devices = await readFile(new URL('../src/SyncDevices.tsx', import.meta.url), 'utf8')
  assert.match(devices, /loadQr\('staff'\)/)
  assert.match(devices, /audience:'staff'/)
  assert.match(devices, /setStaffAccessUrl\(destination \+ '&audience=staff'\)/)
  assert.match(devices, /Staff access/)
  assert.match(devices, /school-issued staff credentials/)
})
