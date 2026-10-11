import {spawnSync} from 'node:child_process'
import {readdirSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
const root=process.cwd(),base=join(root,'.next/component-fixtures'),env={...process.env,CI:'true',E2E_FIXTURE_MODE:'1',START_DEV_SERVER:'1',BASE_URL:'http://127.0.0.1:3000',DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:5432/fixture',NEON_AUTH_BASE_URL:'https://fixture.invalid',NEON_AUTH_COOKIE_SECRET:'fixture-neon-auth-cookie-secret-for-ci-only-00000001',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon-key',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3000',REPORT_SHARE_SECRET:'fixture-report-share-secret-for-ci-only-00000001',AUTH_RETURN_APP_URL:'http://127.0.0.1:3000'}
for(const d of readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory())){env[d.name+'_HTML_DIR']=join(base,d.name);env[d.name+'_CSS_PATH']=join(base,'build.css')}
mkdirSync('artifacts/audit',{recursive:true});env.PLAYWRIGHT_JSON_OUTPUT_NAME=resolve('artifacts/audit/playwright.json');env.PLAYWRIGHT_JUNIT_OUTPUT_NAME=resolve('artifacts/audit/playwright.junit.xml')
const args=['node_modules/@playwright/test/cli.js','test','--workers=1','--reporter=list,json,junit'];if(process.argv.includes('--audit-only'))args.push('--config','playwright.audit-fixtures.config.ts');if(process.argv.includes('--list'))args.push('--list')
const separator=process.argv.indexOf('--');if(separator!==-1)args.push(...process.argv.slice(separator+1))
const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status??1
