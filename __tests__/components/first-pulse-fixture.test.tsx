import {afterAll,it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {writeFileSync,mkdirSync,unlinkSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {build} from 'vite'
import {RunProgress} from '@/components/pulse/RunProgress'
it.each(['en','zh-HK'])('run progress starts with an honest read state in %s',lang=>{const html=renderToStaticMarkup(<RunProgress clientId="11111111-1111-4111-8111-111111111111" lang={lang}/>);expect(html).toContain('first-monitoring');expect(html).not.toContain('0/0');expect(html).not.toContain('$0')})
afterAll(async()=>{
 const dir=process.env.AISO_FIRST_PULSE_HTML_DIR;if(!dir)return;mkdirSync(dir,{recursive:true});const entry=join(resolve(dir),'entry.tsx')
 writeFileSync(entry,"import React from 'react';import{createRoot}from'react-dom/client';import{RunProgress}from'@/components/pulse/RunProgress';createRoot(document.getElementById('root')).render(React.createElement(RunProgress,{clientId:'11111111-1111-4111-8111-111111111111',lang:document.documentElement.lang}));")
 await build({configFile:false,envDir:false,oxc:{jsx:{development:false}},resolve:{alias:{'@':resolve('.'),'next/link':resolve('tests/fixtures/fixture-link.tsx')}},define:{'process.env.NODE_ENV':'"production"'},build:{outDir:resolve(dir),emptyOutDir:false,lib:{entry,name:'FirstPulseFixture',formats:['iife'],fileName:()=> 'fixture.js'}}});unlinkSync(entry)
})
