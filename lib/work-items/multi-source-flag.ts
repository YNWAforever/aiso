/**
 * Attaching a second source changes the output of a stored contract: version
 * content moves from schemaVersion 1 to 2 (051). This repository's rule is
 * that such a change ships behind a flag.
 *
 * With the flag off, every work item has exactly one source and behaviour is
 * identical to before migration 051 -- attachSource/withdrawSource exist and
 * are fully tested, but nothing in the product calls them.
 *
 * This repository has no feature-flag framework. One env var read in one
 * module is the whole mechanism; do not build more.
 */
export function multiSourceEnabled(): boolean {
  return process.env.WORK_ITEM_MULTI_SOURCE_V1 === '1'
}
