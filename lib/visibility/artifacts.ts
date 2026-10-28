import { OutcomeError } from '@/lib/outcome-integrations/input'
import type { VisibilityObservation } from './report'
import type { VisibilityPage } from './page'
export function generateVisibilityArtifact(observation:VisibilityObservation,kind:'brief'|'schema'|'technical_patch',locale:string,page?:VisibilityPage) {
  const target=observation.monitoring.targetUrl
  if(typeof target!=='string')throw new OutcomeError('VISIBILITY_GAP_REQUIRED',409)
  if(kind!=='technical_patch'&&observation.answerPresence!==false&&observation.accuracy!=='inaccurate'&&!(observation.citationsRecorded&&observation.ownedCitations===0))throw new OutcomeError('VISIBILITY_GAP_REQUIRED',409)
  const chinese=locale==='zh-HK',sources=[...new Set(observation.citations.map(citation=>citation.domain))]
  const header=chinese?'待審核提案；不會自動套用或部署。':'Review proposal; nothing is applied or deployed automatically.'
  if(kind==='schema')return JSON.stringify({'@context':'https://schema.org','@type':'WebPage','@id':target+'#webpage',url:target,inLanguage:observation.locale},null,2)
  if(kind==='technical_patch') {
    if(!page||page.url!==target||page.collection!=='complete'||page.canonicalState!=='missing')throw new OutcomeError('VISIBILITY_TECHNICAL_GAP_UNVERIFIED',409)
    const href=target.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    const name=`review/aiso-canonical-${observation.answerDigest.slice(0,12)}.html`
    return `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,3 @@\n+<!-- ${header} -->\n+<!-- ${chinese?'審核後整合至目標頁面 head；保留現有爬蟲政策。':'Integrate into the target page head after review; preserve existing crawler policy.'} -->\n+<link rel="canonical" href="${href}">\n`
  }
  const attributes=Array.isArray(observation.monitoring.expectedAttributes)?observation.monitoring.expectedAttributes.filter(value=>typeof value==='string'):[]
  return chinese?`# 內容簡報（待審核）\n\n${header}\n\n目標：${target}\n問題：${observation.question}\n市場／語言：${observation.market} / ${observation.locale}\n觀察：${observation.id}；${observation.observedAt}；${observation.model??'不明'}\n\n## 已測量缺口\n品牌提及：${observation.answerPresence===null?'不明':observation.answerPresence?'有':'無'}；品牌引用：${observation.ownedCitations}。此為 API 回答樣本，不代表消費者排名。\n\n## 待核實及補充\n${attributes.map(value=>'- '+value).join('\n')||'- 由內容負責人確認預期答案要素。'}\n\n## 可研究的引用來源\n${sources.map(source=>'- '+source).join('\n')||'- 尚無可用來源。'}\n\n核對第一方事實並記錄來源；不要模仿、捏造評論或承諾收錄。發布後重新檢查目標頁面及相同監測問題。`:
    `# Content brief (review required)\n\n${header}\n\nTarget: ${target}\nQuery: ${observation.question}\nMarket / locale: ${observation.market} / ${observation.locale}\nObservation: ${observation.id}; ${observation.observedAt}; ${observation.model??'unknown'}\n\n## Measured gap\nBrand presence: ${observation.answerPresence===null?'unknown':observation.answerPresence?'present':'absent'}; owned citations: ${observation.ownedCitations}. This is an API answer sample, not consumer ranking.\n\n## Verify and address\n${attributes.map(value=>'- '+value).join('\n')||'- Confirm expected answer attributes with the content owner.'}\n\n## Cited sources to investigate\n${sources.map(source=>'- '+source).join('\n')||'- No recorded sources available.'}\n\nCheck first-party facts and record supporting sources. Do not invent reviews or promise inclusion. Revalidate the target page and identical monitored questions after publication.`
}
