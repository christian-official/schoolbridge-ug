export async function clearLocalSyncData(userId: number, deviceId: string) {
  if (typeof indexedDB !== 'undefined') {
    await new Promise<void>(resolve => {
      const deletion = indexedDB.deleteDatabase('schoolbridge-offline-' + userId + '-' + deviceId)
      deletion.onsuccess = () => resolve()
      deletion.onerror = () => resolve()
      deletion.onblocked = () => resolve()
    })
  }
  const prefix = 'schoolbridge-offline-' + userId + '-' + deviceId + '-'
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(prefix)) localStorage.removeItem(key)
  }
}


type EncryptedDraftRecord = { salt: number[]; iv: number[]; ciphertext: number[]; updatedAt: number }

function offlineDatabaseName(userId: number, deviceId: string) {
  return 'schoolbridge-offline-' + userId + '-' + deviceId
}

function openOfflineDatabase(userId: number, deviceId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(offlineDatabaseName(userId, deviceId), 2)
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains('drafts')) opening.result.createObjectStore('drafts')
      if (!opening.result.objectStoreNames.contains('snapshots')) opening.result.createObjectStore('snapshots')
    }
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(new Error('Unable to open encrypted offline storage.'))
  })
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

async function deriveOfflineDraftKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', asArrayBuffer(new TextEncoder().encode(passphrase)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: asArrayBuffer(salt), iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function saveEncryptedOfflineDraft(userId: number, deviceId: string, passphrase: string, value: unknown, replaceExisting = false) {
  if (!passphrase || passphrase.length < 12) throw new Error('Use a passphrase of at least 10 characters.')
  if (!crypto?.subtle || typeof indexedDB === 'undefined') throw new Error('This browser does not support protected offline storage.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveOfflineDraftKey(passphrase, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv) }, key, asArrayBuffer(plaintext)))
  const db = await openOfflineDatabase(userId, deviceId)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      const store = transaction.objectStore('drafts')
      const existing = store.get('teacher-mark-draft')
      let alreadySaved = false
      existing.onsuccess = () => {
        if (existing.result && !replaceExisting) { alreadySaved = true; transaction.abort(); return }
        store.put({ salt: Array.from(salt), iv: Array.from(iv), ciphertext: Array.from(ciphertext), updatedAt: Date.now() } satisfies EncryptedDraftRecord, 'teacher-mark-draft')
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Unable to save the encrypted offline draft.'))
      transaction.onabort = () => reject(new Error(alreadySaved ? 'A protected offline draft is already saved. Submit or clear it before saving another subject.' : 'Offline draft storage was interrupted.'))
    })
  } finally { db.close() }
}

export async function loadEncryptedOfflineDraft<T>(userId: number, deviceId: string, passphrase: string): Promise<T> {
  if (!passphrase || passphrase.length < 12) throw new Error('Enter the passphrase used to protect this draft.')
  if (!crypto?.subtle || typeof indexedDB === 'undefined') throw new Error('This browser does not support protected offline storage.')
  const db = await openOfflineDatabase(userId, deviceId)
  let record: EncryptedDraftRecord | undefined
  try {
    record = await new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').get('teacher-mark-draft')
      request.onsuccess = () => resolve(request.result as EncryptedDraftRecord | undefined)
      request.onerror = () => reject(new Error('Unable to read the encrypted offline draft.'))
    })
  } finally { db.close() }
  if (!record) throw new Error('No encrypted teacher marks draft is saved on this browser.')
  try {
    const salt = new Uint8Array(record.salt), iv = new Uint8Array(record.iv), ciphertext = new Uint8Array(record.ciphertext)
    const key = await deriveOfflineDraftKey(passphrase, salt)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv) }, key, asArrayBuffer(ciphertext))
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    throw new Error('Unable to unlock the draft. Check the passphrase and try again.')
  }
}

export async function deleteEncryptedOfflineDraft(userId: number, deviceId: string) {
  const db = await openOfflineDatabase(userId, deviceId)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      transaction.objectStore('drafts').delete('teacher-mark-draft')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Unable to clear the submitted offline draft.'))
    })
  } finally { db.close() }
}


type EncryptedSnapshotRecord = { salt: number[]; iv: number[]; ciphertext: number[]; updatedAt: number }

export async function saveEncryptedOfflineSnapshot(userId: number, deviceId: string, passphrase: string, value: unknown) {
  if (!passphrase || passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.')
  if (!crypto?.subtle || typeof indexedDB === 'undefined') throw new Error('This browser does not support protected offline storage.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveOfflineDraftKey(passphrase, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv) }, key, asArrayBuffer(plaintext)))
  const db = await openOfflineDatabase(userId, deviceId)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite')
      transaction.objectStore('snapshots').put({
        salt: Array.from(salt), iv: Array.from(iv), ciphertext: Array.from(ciphertext), updatedAt: Date.now(),
      } satisfies EncryptedSnapshotRecord, 'authorised-records')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Unable to save the encrypted offline records.'))
    })
  } finally { db.close() }
}

export async function loadEncryptedOfflineSnapshot<T>(userId: number, deviceId: string, passphrase: string): Promise<T> {
  if (!passphrase || passphrase.length < 12) throw new Error('Enter the passphrase used to protect these records.')
  if (!crypto?.subtle || typeof indexedDB === 'undefined') throw new Error('This browser does not support protected offline storage.')
  const db = await openOfflineDatabase(userId, deviceId)
  let record: EncryptedSnapshotRecord | undefined
  try {
    record = await new Promise((resolve, reject) => {
      const request = db.transaction('snapshots', 'readonly').objectStore('snapshots').get('authorised-records')
      request.onsuccess = () => resolve(request.result as EncryptedSnapshotRecord | undefined)
      request.onerror = () => reject(new Error('Unable to read the encrypted offline records.'))
    })
  } finally { db.close() }
  if (!record) throw new Error('No encrypted offline record snapshot is saved on this browser.')
  try {
    const key = await deriveOfflineDraftKey(passphrase, new Uint8Array(record.salt))
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asArrayBuffer(new Uint8Array(record.iv)) }, key, asArrayBuffer(new Uint8Array(record.ciphertext)))
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    throw new Error('Unable to unlock offline records. Check the passphrase and try again.')
  }
}

export async function deleteEncryptedOfflineSnapshot(userId: number, deviceId: string) {
  const db = await openOfflineDatabase(userId, deviceId)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite')
      transaction.objectStore('snapshots').delete('authorised-records')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Unable to clear the encrypted offline records.'))
    })
  } finally { db.close() }
}
