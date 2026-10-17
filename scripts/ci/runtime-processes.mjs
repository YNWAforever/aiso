export function ownRuntimeChildren({ onStopped = () => {}, timeoutMs = 5000 } = {}) {
  const children=new Set()
  let stopping, interrupted=false, reason
  const stopChild=child=>{
    if(!child.pid||child.exitCode!==null||child.signalCode!==null)return Promise.resolve(true)
    return new Promise(done=>{
      let timer
      const finish=stopped=>{clearTimeout(timer);child.removeListener('exit',exited);done(stopped)}
      const exited=()=>finish(true)
      child.once('exit',exited)
      timer=setTimeout(()=>finish(false),timeoutMs)
      child.kill()
    })
  }
  const stop=why=>{
    if(stopping)return stopping
    reason=why
    stopping=(async()=>{
      const results=await Promise.all([...children].map(stopChild))
      const result={reason,allStopped:results.every(Boolean),pids:[...children].map(child=>child.pid).filter(Boolean)}
      await onStopped(result)
      if(!result.allStopped)process.exitCode=1
      return result
    })()
    return stopping
  }
  const interrupt=why=>{
    interrupted=true
    process.exitCode=why==='SIGINT'?130:why==='SIGTERM'?143:1
    void stop(why).catch(()=>{process.exitCode=1})
  }
  const sigint=()=>interrupt('SIGINT'),sigterm=()=>interrupt('SIGTERM'),disconnect=()=>interrupt('parent-disconnected')
  process.on('SIGINT',sigint)
  process.on('SIGTERM',sigterm)
  process.on('disconnect',disconnect)
  return {
    track(child){
      children.add(child)
      if(stopping)void stopChild(child)
      return child
    },
    get interrupted(){return interrupted},
    get stopping(){return Boolean(stopping)},
    stop,
    dispose(){
      process.removeListener('SIGINT',sigint)
      process.removeListener('SIGTERM',sigterm)
      process.removeListener('disconnect',disconnect)
    },
  }
}
