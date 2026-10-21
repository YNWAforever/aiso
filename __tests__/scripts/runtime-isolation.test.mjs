import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

it('runtime guard rejects sockets and fetch before reaching an owned loopback server', async () => {
  let requests=0
  const server=createServer((_request,response)=>{requests++;response.end('test-only')})
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  try {
    const origin=`http://127.0.0.1:${server.address().port}`
    const script="const net=require('node:net');const out={};try{const s=net.connect({host:'127.0.0.1',port:Number(process.argv[1])});s.destroy()}catch(e){out.socket=e.message}try{await fetch(process.argv[2])}catch(e){out.fetch=e.message}process.stdout.write(JSON.stringify(out));"
    const child=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/fixtures/no-outbound-runtime.mjs')).href,
      '--input-type=commonjs','-e',`(async()=>{${script}})()`,String(server.address().port),origin])
    let stdout='',stderr=''
    child.stdout.on('data',bytes=>{stdout+=bytes})
    child.stderr.on('data',bytes=>{stderr+=bytes})
    const code=await new Promise((done,fail)=>{child.once('error',fail);child.once('close',done)})
    expect(code,stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({socket:'ISOLATED_RUNTIME_OUTBOUND_DISABLED',fetch:'ISOLATED_RUNTIME_OUTBOUND_DISABLED'})
    expect(requests).toBe(0)
  } finally { await new Promise(done=>server.close(done)) }
})

it('default Playwright discovery excludes runtime tests without an owned runtime identity', () => {
  const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test',
    'tests/e2e/isolated-runtime-readonly.spec.ts','--list','--project=chromium','--reporter=json'], {
    encoding:'utf8',env:{...process.env,AISO_RUNTIME_RUN_ID:'',AISO_RUNTIME_IDENTITY_FILE:''},
  })
  expect(result.status).not.toBe(0)
  const report=JSON.parse(result.stdout)
  expect(report.suites).toEqual([])
})
