/**
 * Maps a failed delivery response to the catalogue key the workspace shows.
 * `reason` is the body's `reason` on a 422 DELIVERY_VALIDATION_FAILED;
 * `unknown_page` (a measured page that is not one of this brand's registered
 * pages) gets its own key because the owner can fix it and the generic
 * "check the fields" would send them to the wrong place.
 */
export function deliveryFailureKey(status: number, reason?: unknown): string {
  if (status === 422 && reason === 'unknown_page') return 'unknownPage'
  return status === 401 ? 'unauthenticated' : status === 403 ? 'denied' : status === 409 ? 'conflict' : status === 400 || status === 413 || status === 422 ? 'invalid' : 'unavailable'
}
