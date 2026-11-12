export async function fetchSchoolBridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    if (error instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      throw new TypeError("SchoolBridge could not complete this server request. Your device may still be online; the service or this request may be temporarily unavailable. Retry after checking whether the action was completed.")
    }
    throw error
  }
  if ([502, 503, 504].includes(response.status)) {
    throw new TypeError("SchoolBridge's server is temporarily unavailable. Reconnect or try again later; check an action's status before retrying.")
  }
  return response
}
