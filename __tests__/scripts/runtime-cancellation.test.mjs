import { expect, it } from 'vitest'
import { fork } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { ownRuntimeChildren } from '../../scripts/ci/runtime-processes.mjs'

it('shutdown is idempotent and retains the first terminal reason',async()=>{
  const terminals=[]
  const owned=ownRuntimeChildren({onStopped:result=>{terminals.push(result)}})
  try{
    const first=owned.stop('completed'),second=owned.stop('later')
    expect(first).toBe(second)
    expect(await first).toEqual({reason:'completed',allStopped:true,pids:[]})
    expect(terminals).toHaveLength(1)
  }finally{owned.dispose()}
})

it('parent disconnect stops only the launcher-owned children and records interruption', async () => {
  const lifecycleModule=pathToFileURL(resolve('scripts/ci/runtime-processes.mjs')).href
  // Children self-expire in 5s even if shutdown is broken. Expected
  // cancellation must finish in 2s, so that fallback cannot make RED pass.
  const code=`import{spawn}from'node:child_process';import{ownRuntimeChildren}from${JSON.stringify(lifecycleModule)};const owned=ownRuntimeChildren({onStopped:result=>{console.log(JSON.stringify(result));owned.dispose()}});const children=[1,2].map(()=>owned.track(spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],{stdio:'ignore'})));process.send({pids:children.map(child=>child.pid)});`
  const dir=resolve('artifacts/product-browser-regression-20261017/cancellation-fixture')
  mkdirSync(dir,{recursive:true})
  const entry=resolve(dir,'launcher.mjs')
  writeFileSync(entry,code)
  const launcher=fork(entry,[],{silent:true,execArgv:[]})
  const diagnostic=(event,detail)=>appendFileSync(resolve(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,detail})+'\n')
  diagnostic('fork',{pid:launcher.pid})
  for(const event of ['spawn','exit','close','disconnect','message','error'])launcher.on(event,(...detail)=>diagnostic(event,detail))
  let stdout='',stderr='',pids=[]
  launcher.stdout.on('data',bytes=>{stdout+=bytes;diagnostic('stdout',String(bytes))})
  launcher.stderr.on('data',bytes=>{stderr+=bytes;diagnostic('stderr',String(bytes))})
  const exited=new Promise(done=>launcher.once('exit',done))
  try {
    pids=await new Promise((done,fail)=>{launcher.once('message',value=>done(value.pids));launcher.once('error',fail);launcher.once('exit',()=>fail(new Error('Launcher exited before ready')))})
    expect(pids).toHaveLength(2)
    launcher.disconnect()
    let timer
    const ended=await Promise.race([exited.then(()=>true),new Promise(done=>{timer=setTimeout(()=>done(false),2000)})])
    clearTimeout(timer)
    expect(ended,stderr).toBe(true)
    const terminal=JSON.parse(stdout.trim())
    expect(terminal).toMatchObject({reason:'parent-disconnected',allStopped:true,pids})
    for(const pid of pids){
      let absent=false
      try{process.kill(pid,0)}catch(error){absent=error.code==='ESRCH'}
      expect(absent).toBe(true)
    }
  }finally{
    // The fixed-lifetime children ensure failed-test cleanup needs no PID kill.
    await exited
    launcher.stdin?.destroy()
    launcher.stdout.destroy()
    launcher.stderr.destroy()
  }
})
