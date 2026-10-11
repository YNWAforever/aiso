import { describe, expect, it } from 'vitest'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { projectScanStatus } from '@/lib/view-models/scan-status'
const evidence = (collection: 'failed'|'complete', httpStatus: number) => buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:null,region:null,sitemapSource:'unknown',checks:{}, observations:[{check:'page',collection,httpStatus,target:{origin:'https://example.com'}}]})
describe('UC05 scan status projection', () => {
 it('withholds raw score and grade over recorded failed evidence', () => { expect(projectScanStatus({score:3.5,grade:'F',evidence:evidence('failed',503)})).toEqual({state:'failed',score:null,grade:null}) })
 it('retains a successful historical page score without fabricating full coverage', () => { expect(projectScanStatus({score:62,grade:'C',evidence:evidence('complete',200)})).toEqual({state:'limited',score:62,grade:'C'}) })
 it.each([undefined, null, {}, {collection:'complete'}])('keeps missing or malformed evidence unknown: %j', value => { expect(projectScanStatus({score:3.5,grade:'F',evidence:value})).toEqual({state:'unknown',score:null,grade:null}) })
 it('never scores evidence with no successful page', () => {expect(projectScanStatus({score:62,grade:'C',evidence:buildScanEvidence({requestedUrl:'https://example.com',evaluatedUrl:'https://example.com',industry:null,region:null,sitemapSource:'unknown',checks:{c1_robots:{collection:'complete',assessment:'pass'}}})})).toEqual({state:'unknown',score:null,grade:null})})
})
