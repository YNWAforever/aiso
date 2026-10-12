export type PulseBlockReason='paused'|'no_models'|'no_prompts'|'context_missing'|'quota_exceeded'|'existing_run'|'legacy_review_required'
export type PulseAvailabilityInput={enabled:boolean;variants:number;prompts:number;contextConfirmed:boolean;remaining:number;expected:number;currentCanonicalId:string|null;legacyCurrentWeek:boolean}
export type PulseAvailability={canStart:boolean;reasons:PulseBlockReason[];action:'start'|'edit_prompts'|'view_existing'|'wait'}
/** Describes confirmed inputs only; read failures are unavailable, never zero. */
export function derivePulseAvailability(input:PulseAvailabilityInput):PulseAvailability{
 const reasons:PulseBlockReason[]=[]
 if(!input.enabled)reasons.push('paused')
 if(input.variants===0)reasons.push('no_models')
 if(input.prompts===0)reasons.push('no_prompts')
 if(!input.contextConfirmed)reasons.push('context_missing')
 if(input.remaining<input.expected)reasons.push('quota_exceeded')
 if(input.currentCanonicalId)reasons.push('existing_run')
 if(input.legacyCurrentWeek)reasons.push('legacy_review_required')
 const action=input.currentCanonicalId||input.legacyCurrentWeek?'view_existing':!input.prompts||!input.contextConfirmed?'edit_prompts':reasons.length?'wait':'start'
 return{canStart:reasons.length===0,reasons,action}
}
