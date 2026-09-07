import { beforeEach, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { PromptBankEditor } from '@/components/pulse/PromptBankEditor'
import type { PromptBankItem } from '@/lib/types'
const state=vi.hoisted(()=>({values:[] as unknown[],cursor:0}))
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{const index=state.cursor++;if(!(index in state.values))state.values[index]=initial;return[state.values[index],(value:unknown)=>{state.values[index]=value}]}}))
vi.mock('next-intl',()=>({useTranslations:()=> (key:string)=>key}))
type Element=ReactElement<Record<string,unknown>&{children?:ReactNode}>
function nodes(node:ReactNode):Element[]{return Children.toArray(node).flatMap(child=>isValidElement(child)?[child as Element,...nodes((child as Element).props.children)]:[])}
const prompt:PromptBankItem={id:'p1',client_id:'c1',category:'brand_query',question:'Original',language:'en',is_active:true,created_at:'2026-09-01'}
beforeEach(()=>{state.values=[];state.cursor=0;vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('network secret')))})
it.each(['onToggle','onEdit','onDelete'])('rolls back a rejected %s request',async handler=>{const changed=vi.fn();const tree=PromptBankEditor({clientId:'c1',prompts:[prompt],onPromptsChange:changed});const row=nodes(tree).find(node=>node.props.prompt===prompt)!;const run=row.props[handler] as (...args:unknown[])=>Promise<void>;await expect(run('p1',handler==='onToggle'?false:'New text')).resolves.toBeUndefined();expect(changed).toHaveBeenLastCalledWith([prompt]);expect(state.values).toContain('qb_save_failed')})
it('clears pending Add after rejected request so the same question can be retried',async()=>{const tree=PromptBankEditor({clientId:'c1',prompts:[prompt],onPromptsChange:vi.fn()});const add=nodes(tree).find(node=>node.props.category==='brand_query'&&node.props.onAdd)!;state.values=['Draft',false];state.cursor=0;const form=(add.type as (props:typeof add.props)=>Element)(add.props);await expect((form.props.onSubmit as (event:{preventDefault:()=>void})=>Promise<void>)({preventDefault:()=>{}})).resolves.toBeUndefined();expect(state.values[0]).toBe('Draft');expect(state.values[1]).toBe(false)})
