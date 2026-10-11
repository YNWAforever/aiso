import {describe,it,expect} from 'vitest'
import {registrableDomain,isWithin} from '@/lib/citations/normalize'
import {buildCitationReport} from '@/lib/citations/report'
describe('citation PSL identity',()=>{
 it('isolates privately hosted sites and public suffixes',()=>{
 expect(registrableDomain('foo.github.io')).toBe('foo.github.io');expect(registrableDomain('bar.github.io')).toBe('bar.github.io')
 expect(registrableDomain('personal.hsbc.com.hk')).toBe('hsbc.com.hk');expect(registrableDomain('news.example.co.uk')).toBe('example.co.uk')
 expect(isWithin('bar.github.io','foo.github.io')).toBe(false)
 })
 it('keeps IP and localhost identities and rejects malformed hosts',()=>{
 expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1');expect(registrableDomain('localhost')).toBe('localhost');expect(registrableDomain('bücher.de')).toBe('xn--bcher-kva.de')
 expect(registrableDomain('a..com')).toMatch(/^invalid:/);expect(isWithin('bad/path.com','path.com')).toBe(false)
 })
 it('does not assign an aggregate kind based on citation order',()=>{
 const context={ownedDomains:[],competitors:[]},a={scan_week:'2026-10-05',platform:'fixture',prompt_id:'p',question:'q',provider_citations:[{url:'https://www.example.com/page'},{url:'https://forum.example.com/thread'}]}
 const report=buildCitationReport({context,answers:[a]});const reverse=buildCitationReport({context,answers:[{...a,provider_citations:[...a.provider_citations].reverse()}]})
 expect(report.domains).toEqual(reverse.domains);expect(report.normalizationVersion).toBe('psl-private-tldts-7.4.10.v1')
 })
})
