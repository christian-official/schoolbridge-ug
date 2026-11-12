export async function fetchSchoolBridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    if (error instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      throw new TypeError("SchoolBridge cannot reach its server right now. You're offline or the connection is unavailable. Reconnect to refresh live records; check an action's status before retrying.")
    }
    throw error
  }
  if ([502, 503, 504].includes(response.status)) {
    throw new TypeError("SchoolBridge's server is temporarily unavailable. Reconnect or try again later; check an action's status before retrying.")
  }
  return response
}
