// Legacy offline data is removed when an account reconnects. SchoolBridge now
// uses live server-backed records; this helper only clears data created by older builds.
export async function clearLocalSyncData(userId: number, deviceId: string) {
  if (typeof indexedDB !== 'undefined') {
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase('schoolbridge-offline-' + userId + '-' + deviceId)
      deletion.onsuccess = () => resolve()
      deletion.onerror = () => reject(new Error('Unable to clear legacy local data.'))
    })
  }
  const prefix = 'schoolbridge-offline-' + userId + '-' + deviceId + '-'
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(prefix)) localStorage.removeItem(key)
  }
}
