import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
// Node strip-types requires the explicit extension; this offline entrypoint does not use Next resolution.
// @ts-expect-error -- Node executes the relative TypeScript source directly.
import {coerceAnalysis,naiveAnalysis,type AnswerAnalysisV2} from '../lib/pulse/analysis-fallback.ts'
type Case={id:string;locale:string;category:string;reviewStatus:string;brandName:string;answer:string;classifierResponse:unknown;
  expected:{brandMentioned:boolean|null;sentiment:AnswerAnalysisV2['sentiment']}}
const args=process.argv.slice(2),arg=(name:string)=>args[args.indexOf(name)+1]
if(arg('--mode')!=='fixtures'||!args.includes('--input')||!args.includes('--output'))
  throw new Error('Required: --mode fixtures --input <file> --output <file>; no live-provider mode exists')
const data=JSON.parse(await readFile(arg('--input'),'utf8')) as {cases:Case[]}
if(!Array.isArray(data.cases)||data.cases.length!==120||new Set(data.cases.map(c=>c.id)).size!==120)throw new Error('Expected 120 unique synthetic fixtures')
const mentionMatrix:Record<string,Record<string,number>>={},sentimentMatrix:Record<string,Record<string,number>>={}
const counts:Record<string,number>={},failures:string[]=[]
let truePositive=0,falsePositive=0,falseNegative=0,abstentions=0
const key=(v:boolean|null)=>v===null?'unknown':v?'mentioned':'not_mentioned'
const add=(matrix:Record<string,Record<string,number>>,truth:string,prediction:string)=>{
  matrix[truth]??={};matrix[truth][prediction]=(matrix[truth][prediction]??0)+1
}
for(const c of data.cases){
  counts[c.locale+':'+c.category]=(counts[c.locale+':'+c.category]??0)+1
  if(!c.reviewStatus.startsWith('unreviewed'))throw new Error('Reviewed labels need separate reviewer provenance')
  const result=coerceAnalysis(c.classifierResponse,c.answer,c.brandName)??naiveAnalysis(c.answer,c.brandName)
  add(mentionMatrix,key(c.expected.brandMentioned),key(result.brandMentioned))
  add(sentimentMatrix,c.expected.sentiment,result.sentiment)
  if(result.brandMentioned===null)abstentions++
  if(c.expected.brandMentioned===true&&result.brandMentioned===true)truePositive++
  if(c.expected.brandMentioned!==true&&result.brandMentioned===true)falsePositive++
  if(c.expected.brandMentioned===true&&result.brandMentioned!==true)falseNegative++
  if(result.brandMentioned!==c.expected.brandMentioned||result.sentiment!==c.expected.sentiment)failures.push(c.id)
}
if(Object.keys(counts).length!==12||Object.values(counts).some(n=>n!==10))throw new Error('Expected en/zh-HK 60 each, six categories 20 each')
const report={scope:'Synthetic parser/fallback behavior; not live model accuracy',reviewStatus:'unreviewed-synthetic',
  n:data.cases.length,counts,abstentions,precision:truePositive+falsePositive?truePositive/(truePositive+falsePositive):null,
  recall:truePositive+falseNegative?truePositive/(truePositive+falseNegative):null,
  truePositive,falsePositive,falseNegative,mentionConfusionMatrix:mentionMatrix,sentimentConfusionMatrix:sentimentMatrix,
  failureCount:failures.length,failures,paidProviderCalls:0}
await mkdir(dirname(arg('--output')),{recursive:true})
await writeFile(arg('--output'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({n:report.n,failureCount:report.failureCount,precision:report.precision,recall:report.recall,abstentions,paidProviderCalls:0}))
if(failures.length)process.exitCode=1
