import { afterAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PortfolioView } from '@/components/dashboard/PortfolioView'
import { portfolioFixture } from '../../tests/fixtures/portfolio'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
const render = (state:Parameters<typeof portfolioFixture>[0],lang:string) => renderToStaticMarkup(<PortfolioView portfolio={portfolioFixture(state)} lang={lang} creationControl={<button type="button" className="min-h-11 rounded-lg border border-border px-4 text-foreground">Create fixture brand</button>} />)
describe('real portfolio presentation', () => {
  it.each(['en','zh-HK'])('renders truthful capacity and optional sections in %s',lang=>{
    const copy=(lang==='en'?en:zh).portfolio
    expect(render('unknown',lang)).toContain(copy.capacityUnknown)
    expect(render('unknown',lang)).not.toContain('Create fixture brand')
    expect(render('atLimit',lang)).toContain(copy.capacityLimit)
    expect(render('atLimit',lang)).not.toContain('Create fixture brand')
    expect(render('empty',lang)).toContain('Create fixture brand')
    expect(render('error',lang)).toContain(copy.historyError)
    expect(render('error',lang)).toContain(copy.visibilityError)
    expect(render('error',lang)).not.toContain('0%')
  })
  it('keeps real owned-home and guarded result links with persisted score/grade',()=>{
    const html=render('ready','en')
    expect(html).toContain('href="/en/dashboard/client-a"')
    expect(html).toContain('href="/en/result/scan-a"')
    expect(html).toContain('25%')
    expect(html).toContain('62')
    expect(html).toContain('C')
    expect(html).not.toMatch(/improvement|delivered|verified entity/i)
  })
})
afterAll(()=>{
  const directory=process.env.C8B_HTML_DIR
  if(!directory)return
  mkdirSync(directory,{recursive:true})
  for(const lang of ['en','zh-HK']){
    writeFileSync(join(directory,`${lang}-copy.json`),JSON.stringify((lang==='en'?en:zh).portfolio),'utf8')
    for(const state of ['ready','empty','error','unknown','atLimit'] as const)writeFileSync(join(directory,`${lang}-${state}.html`),render(state,lang),'utf8')
  }
})
