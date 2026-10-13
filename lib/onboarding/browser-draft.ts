'use client'
const FIELD='__aisoOnboardingDrafts',REV='__aisoDraftRevision',CLEARED='__aisoDraftCleared',LIMIT=20000,SCOPES=8
const validKey=(key:string)=>key.startsWith('aiso:onboarding:')&&key.length<=200
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
type Entry={value:string|null;revision:number}
const validRevision=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<1e15
function entries(key:string):Entry[]{
 const result:Entry[]=[]
 try{const state=window.history.state,cache=object(state)?state[FIELD]:null,item=object(cache)?cache[key]:null;if(object(item)&&validRevision(item.revision)&&(item.value===null||typeof item.value==='string'&&item.value.length<=LIMIT))result.push(item as Entry)}catch{}
 try{const raw=window.sessionStorage.getItem(key);if(raw){const parsed=JSON.parse(raw);if(object(parsed)){const revision=validRevision(parsed[REV])?parsed[REV]:0;const value={...parsed};delete value[REV];delete value[CLEARED];const clean=JSON.stringify(value);if(clean.length<=LIMIT)result.push({value:parsed[CLEARED]===true?null:clean,revision})}}}catch{}
 return result.sort((a,b)=>b.revision-a.revision)
}
export function loadBrowserDraft(key:string):string|null{
 if(typeof window==='undefined'||!validKey(key))return null
 return entries(key)[0]?.value??null
}
function write(key:string,value:string|null):boolean{
 if(typeof window==='undefined'||!validKey(key)||(value!==null&&value.length>LIMIT))return false
 let parsed:Record<string,unknown>={}
 try{if(value!==null){const input=JSON.parse(value);if(!object(input))return false;parsed=input}}catch{return false}
 const revision=Math.max(Date.now(),(entries(key)[0]?.revision??0)+1)
 let saved=false
 try{window.sessionStorage.setItem(key,JSON.stringify({...parsed,[REV]:revision,...(value===null?{[CLEARED]:true}:{})}));saved=true}catch{}
 try{
  const prior=window.history.state,state=object(prior)?prior:{},cache=object(state[FIELD])?state[FIELD]:{}
  const retained=Object.entries(cache).filter(([scope,item])=>scope!==key&&validKey(scope)&&object(item)&&validRevision(item.revision)&&(item.value===null||typeof item.value==='string'&&item.value.length<=LIMIT))
  const next=Object.fromEntries([...retained,[key,{value,revision}]].slice(-SCOPES))
  window.history.replaceState({...state,[FIELD]:next},'',window.location.href);saved=true
 }catch{}
 return saved
}
/** Private tab cache only. Server ownership/intent hashes remain authoritative. */
export function saveBrowserDraft(key:string,value:string):boolean{return write(key,value)}
/** Tombstones prevent a failed removal in either cache resurrecting saved input. */
export function removeBrowserDraft(key:string):void{write(key,null)}
