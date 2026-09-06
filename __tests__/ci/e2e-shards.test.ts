import { describe, expect, it } from 'vitest'
import { mergeE2EShards } from '../../scripts/ci/merge-e2e-shards.mjs'
const good = () => Array.from({length:4},()=>({schemaVersion:1,job:'e2e-accessibility',commitSha:'head',status:'success',executed:3,skipped:0,failurePriorities:[],artifacts:[]}))
describe('complete E2E shard evidence',()=>{
 it('sums all four valid shards',()=>expect(mergeE2EShards(good(),'head')).toMatchObject({status:'success',executed:12,skipped:0}))
 for(const [name,change] of [
  ['missing',(s:Record<string, unknown>[])=>{s.pop()}], ['malformed',(s:Record<string, unknown>[])=>{s[0]={}}],
  ['wrong commit',(s:Record<string, unknown>[])=>{s[1].commitSha='old'}], ['wrong job',(s:Record<string, unknown>[])=>{s[1].job='build'}],
  ['failed',(s:Record<string, unknown>[])=>{s[1].status='failure'}], ['skipped',(s:Record<string, unknown>[])=>{s[1].skipped=1}],
  ['empty',(s:Record<string, unknown>[])=>{s[1].executed=0}], ['invalid count',(s:Record<string, unknown>[])=>{s[1].executed='3'}],
  ['blocking finding',(s:Record<string, unknown>[])=>{s[1].failurePriorities=['P0']}],
 ] as const) it(`rejects ${name} evidence`,()=>{const s=good();change(s);expect(mergeE2EShards(s,'head')).toMatchObject({status:'failure',failurePriorities:['P0']})})
})
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readE2EShards } from '../../scripts/ci/merge-e2e-shards.mjs'

it('requires each numbered artifact, supports nested downloads and rejects a truncated shard', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aiso-e2e-shards-'))
 try {
  await mkdir(join(dir,'artifacts'))
  const shards=good()
  for(let i=0;i<4;i++)await writeFile(join(dir,i%2?'artifacts':'',`e2e-accessibility-${i+1}-summary.json`),JSON.stringify(shards[i]))
  expect(mergeE2EShards(await readE2EShards(dir),'head').status).toBe('success')
  await writeFile(join(dir,'artifacts','e2e-accessibility-2-summary.json'),'{')
  expect(mergeE2EShards(await readE2EShards(dir),'head').status).toBe('failure')
 } finally { await rm(dir,{recursive:true,force:true}) }
})
