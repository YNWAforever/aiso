type Section='recommendations'|'progress'|'competitors'
const fields:Record<Section,readonly string[]>={recommendations:['impact_score'],progress:['current_value','previous_value','delta'],competitors:['mention_rate','your_rate']}

/** Neon numeric columns are strings; absent nullable observations stay unknown. */
export function normalizeAgentNumbers<T extends object>(row:T,section:Section):T {
  const result={...row} as Record<string,unknown>
  for(const key of fields[section]){
    if(!(key in row))continue
    const raw=result[key]
    const value=(typeof raw==='number'||typeof raw==='string'&&raw.trim()!=='')?Number(raw):null
    const normalized=value!==null&&Number.isFinite(value)?value:null
    if(normalized===null&&key!=='previous_value'&&key!=='delta')throw new Error('Unavailable stored agent metric')
    result[key]=normalized
  }
  return result as T
}
