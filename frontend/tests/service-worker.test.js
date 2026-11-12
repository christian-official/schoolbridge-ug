import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const serviceWorkerSource = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8')

function createWorker({ fetchImpl = async () => ({ ok: true }), cacheMatch = async () => undefined } = {}) {
  const listeners = {}
  const self = {
    location: { origin: 'https://school.example' },
    addEventListener: (name, handler) => { listeners[name] = handler },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  const caches = {
    match: cacheMatch,
    open: async () => ({ match: async () => ({ shell: true }), put: async () => {} }),
    keys: async () => ['schoolbridge-shell-v0', 'schoolbridge-shell-v1'],
    delete: async () => true,
  }
  vm.runInNewContext(serviceWorkerSource, { self, caches, fetch: fetchImpl, URL, Promise })
  return listeners
}

test('service worker accepts an explicit user request to activate a waiting update', async () => {
  const listeners = {}
  let skipped = false
  const self = {
    location: { origin: 'https://school.example' },
    addEventListener: (name, handler) => { listeners[name] = handler },
    skipWaiting: async () => { skipped = true },
    clients: { claim: async () => {} },
  }
  vm.runInNewContext(serviceWorkerSource, { self, caches: {}, fetch, URL, Promise })
  await listeners.message({ data: { type: 'SCHOOLBRIDGE_SKIP_WAITING' } })
  assert.equal(skipped, true)
})

test('service worker never intercepts API reads or writes', () => {
  const listeners = createWorker()
  for (const request of [
    { method: 'GET', url: 'https://school.example/api/students', mode: 'cors', destination: '' },
    { method: 'POST', url: 'https://school.example/api/attendance', mode: 'cors', destination: '' },
  ]) {
    let intercepted = false
    listeners.fetch({ request, respondWith: () => { intercepted = true } })
    assert.equal(intercepted, false)
  }
})

test('service worker never intercepts cross-origin requests', () => {
  const listeners = createWorker()
  let intercepted = false
  listeners.fetch({
    request: { method: 'GET', url: 'https://cdn.example/app.js', mode: 'cors', destination: 'script' },
    respondWith: () => { intercepted = true },
  })
  assert.equal(intercepted, false)
})

test('navigation falls back to the cached app shell when network is unavailable', async () => {
  const listeners = createWorker({ fetchImpl: async () => { throw new Error('offline') } })
  let response
  listeners.fetch({
    request: { method: 'GET', url: 'https://school.example/students', mode: 'navigate', destination: 'document' },
    respondWith: promise => { response = promise },
  })
  assert.deepEqual(await response, { shell: true })
})

test('static assets use a cached response before attempting the network', async () => {
  const cachedAsset = { cached: 'app.js' }
  const listeners = createWorker({ cacheMatch: async () => cachedAsset })
  let response
  listeners.fetch({
    request: { method: 'GET', url: 'https://school.example/assets/app.js', mode: 'cors', destination: 'script' },
    respondWith: promise => { response = promise },
  })
  assert.equal(await response, cachedAsset)
})
