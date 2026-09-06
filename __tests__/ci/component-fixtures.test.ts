import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareComponentFixtures } from '../../scripts/ci/prepare-component-fixtures.mjs'

describe('CI component fixture preparation',()=>{
 it('requires real build CSS and propagates renderer failure',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aiso-component-ci-'))
  try {
   let calls=0
   const run=()=>{calls++;return {status:1}}
   await expect(prepareComponentFixtures(root,{NODE_ENV: 'test'},run)).rejects.toThrow()
   expect(calls).toBe(0)
   await mkdir(join(root,'.next/static/chunks'),{recursive:true})
   await writeFile(join(root,'.next/static/chunks/a.css'),'body{color:red}')
   await expect(prepareComponentFixtures(root,{NODE_ENV: 'test'},run)).rejects.toThrow('renderer')
   expect(calls).toBe(1)
  }finally{await rm(root,{recursive:true,force:true})}
 })
 it('generates every required slice with final CSS and renderer environment',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aiso-component-ci-'))
  try{
   await mkdir(join(root,'.next/static/chunks'),{recursive:true})
   await writeFile(join(root,'.next/static/chunks/a.css'),'a{}')
   await writeFile(join(root,'.next/static/chunks/b.css'),'b{}')
   await prepareComponentFixtures(root,{NODE_ENV: 'test'},(_bin:string,args:string[],options:{env:NodeJS.ProcessEnv})=>{
    expect(args.filter(a=>a.endsWith('.test.tsx'))).toEqual(['workspace-home','portfolio','pulse-view','settings','entity','observation','opportunity','draft','change-set','approver-access','delivery'].map(name=>`__tests__/components/${name}-render.test.tsx`))
    for(const slice of ['C8A','C8B','C8C','C8G','C9A','C9B','C9C','C9C_DRAFT','C9D','C9D_APPROVERS','C9E']){expect(options.env[`${slice}_HTML_DIR`]).toBe(join(root,'.next/component-fixtures',slice));expect(options.env[`${slice}_CSS_PATH`]).toBe(join(root,'.next/component-fixtures/build.css'))}
    return {status:0}
   })
   expect(await readFile(join(root,'.next/component-fixtures/build.css'),'utf8')).toBe('a{}\nb{}')
  }finally{await rm(root,{recursive:true,force:true})}
 })
})
