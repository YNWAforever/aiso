'use client'
import {LineChart,Line,XAxis,YAxis,Tooltip,ResponsiveContainer} from 'recharts'
import type {PulsePoint} from '@/lib/view-models/pulse'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
export function SovChart({data,lang='en',label}:{data:PulsePoint[];lang?:string;label?:string}){
 const copy=(lang==='zh-HK'?zhHK:en).pulseView
 return <div className="min-w-0">
  <p className="mb-3 text-xs text-muted-foreground">{copy.gaps}</p>
  <div aria-hidden="true"><ResponsiveContainer width="100%" height={180}>
   <LineChart data={data}><XAxis dataKey="week" tick={{fontSize:10}}/><YAxis domain={[0,100]} unit="%"/>
    <Tooltip formatter={value=>[`${value}%`,copy.value]}/><Line type="linear" dataKey="sov" stroke="var(--primary)" strokeWidth={2} dot={{r:3}} connectNulls={false} isAnimationActive={false}/>
   </LineChart>
  </ResponsiveContainer></div>
  <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-foreground">{label??copy.aggregate} · {copy.value}</summary>
   <table className="w-full text-sm"><caption className="sr-only">{label??copy.aggregate}</caption><thead><tr><th scope="col" className="py-2 text-left">{copy.week}</th><th scope="col" className="py-2 text-right">{copy.value}</th></tr></thead>
    <tbody>{data.map(point=><tr key={point.week} className="border-t border-border"><th scope="row" className="py-2 text-left font-normal">{point.week}</th><td className="py-2 text-right">{point.sov===null?copy.unknown:`${point.sov}%`}</td></tr>)}</tbody>
   </table>
  </details>
 </div>
}
