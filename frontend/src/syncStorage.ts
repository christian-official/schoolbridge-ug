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
